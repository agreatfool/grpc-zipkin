import * as zipkin from "zipkin";
import * as grpc from "grpc";
import {MiddlewareNext, RpcContext, RpcMiddleware, GatewayContext} from "sasdn";

export interface MiddlewareOptions {
    tracer: zipkin.Tracer;
    serviceName?: string;
    remoteServiceName?: string;
    port?: number;
}

export class GrpcInstrumentation {
    public static middleware(options: MiddlewareOptions): RpcMiddleware {
        const tracer = options.tracer;
        const serviceName = options.serviceName || "unknown";
        const remoteServiceName = options.remoteServiceName || "unknown";
        const port = options.port || 0;

        if (tracer === false) {
            return async (ctx: RpcContext, next: MiddlewareNext) => {
                await next();
            };
        }

        return async (ctx: RpcContext, next: MiddlewareNext) => {
            const metadata = ctx.call.metadata as grpc.Metadata;

            function readMetadata(headerName: string) {
                const val = metadata.get(headerName.toLowerCase())[0];
                if (val !== undefined) {
                    return new zipkin.option.Some(val);
                } else {
                    return zipkin.option.None;
                }
            }

            if (GrpcInstrumentation._containsIncomingMetadata(metadata)) {
                const spanId = readMetadata(zipkin.HttpHeaders.SpanId);
                spanId.ifPresent((sid: zipkin.spanId) => {
                    const childId = new zipkin.TraceId({
                        traceId: readMetadata(zipkin.HttpHeaders.TraceId),
                        parentId: readMetadata(zipkin.HttpHeaders.ParentSpanId),
                        spanId: sid,
                        sampled: readMetadata(zipkin.HttpHeaders.Sampled).map(GrpcInstrumentation._stringToBoolean),
                        flags: readMetadata(zipkin.HttpHeaders.Flags).flatMap(GrpcInstrumentation._stringToIntOption).getOrElse(0)
                    });
                    tracer.setId(childId);
                });
            } else {
                const rootId = tracer.createRootId();
                if (metadata.get(zipkin.HttpHeaders.Flags.toLowerCase())[0]) {
                    const rootIdWithFlags = new zipkin.TraceId({
                        traceId: rootId.traceId,
                        parentId: rootId.parentId,
                        spanId: rootId.spanId,
                        sampled: rootId.sampled,
                        flags: readMetadata(zipkin.HttpHeaders.Flags)
                    });
                    tracer.setId(rootIdWithFlags);
                } else {
                    tracer.setId(rootId);
                }
            }

            const traceId = tracer.id;

            tracer.scoped(() => {
                tracer.setId(traceId);
                tracer.recordServiceName(serviceName);
                tracer.recordRpc('rpc');
                tracer.recordAnnotation(new zipkin.Annotation.ServerRecv());
                tracer.recordAnnotation(new zipkin.Annotation.LocalAddr({port}));
                if (remoteServiceName) {
                    tracer.recordAnnotation(new zipkin.Annotation.ServerAddr({
                        serviceName: remoteServiceName
                    }));
                }

                if (traceId.flags !== 0 && traceId.flags != null) {
                    tracer.recordBinary(zipkin.HttpHeaders.Flags, traceId.flags.toString());
                }
            });

            ctx[zipkin.HttpHeaders.TraceId] = traceId;

            await next();

            tracer.scoped(() => {
                tracer.setId(traceId);
                tracer.recordAnnotation(new zipkin.Annotation.ServerSend());
            });
        };
    }

    public static proxyClient<T>(client: T, ctx: GatewayContext | RpcContext, options: MiddlewareOptions): T {
        const tracer = options.tracer;
        const serviceName = options.serviceName || "unknown";
        const port = options.port || 0;

        if (tracer === false) {
            return client;
        }

        if (ctx[zipkin.HttpHeaders.TraceId] instanceof zipkin.TraceId) {
            tracer.setId(ctx[zipkin.HttpHeaders.TraceId]);
        }

        Object.getOwnPropertyNames(Object.getPrototypeOf(client)).forEach((property) => {
            const original = client[property];
            if (property != 'constructor' && typeof original == 'function') {

                client[property] = function () {
                    // has grpc.Metadata
                    if (arguments[0] instanceof grpc.Metadata || arguments[1] instanceof grpc.Metadata) {
                        return original.apply(client, arguments);
                    }

                    // create SpanId
                    tracer.setId(tracer.createChildId());
                    const traceId = tracer.id;

                    const metadata = GrpcInstrumentation._makeMetadata(traceId);
                    const argus = GrpcInstrumentation._replaceArguments(arguments, metadata, (callback) => {
                        return (err, res) => {
                            tracer.scoped(() => {
                                tracer.setId(traceId);
                                tracer.recordBinary('rpc.end', 'callback');
                                tracer.recordAnnotation(new zipkin.Annotation.ClientRecv());
                            });
                            callback(err, res);
                        };
                    });

                    tracer.scoped(() => {
                        tracer.recordServiceName(serviceName);
                        tracer.recordRpc(`rpc`);
                        tracer.recordBinary('rpc.query', property);
                        tracer.recordAnnotation(new zipkin.Annotation.ClientSend());
                        tracer.recordAnnotation(new zipkin.Annotation.LocalAddr({port}));

                        if (traceId.flags !== 0 && traceId.flags != null) {
                            tracer.recordBinary(zipkin.HttpHeaders.Flags, traceId.flags.toString());
                        }
                    });

                    const call = original.apply(client, argus);
                    call.on('end', function () {
                        tracer.scoped(() => {
                            tracer.setId(traceId);
                            tracer.recordBinary('rpc.end', 'call');
                            tracer.recordAnnotation(new zipkin.Annotation.ClientRecv());
                        });
                    });

                    return call;
                };
            }
        });

        return client;
    }

    private static _containsIncomingMetadata(metadata: grpc.Metadata): boolean {
        return metadata.get(zipkin.HttpHeaders.TraceId.toLowerCase())[0] !== undefined && metadata.get(zipkin.HttpHeaders.SpanId.toLowerCase())[0] !== undefined;
    }

    private static _stringToBoolean(str: string): boolean {
        return str === '1';
    }

    private static _stringToIntOption(str: string): any {
        try {
            return new zipkin.option.Some(parseInt(str));
        } catch (err) {
            return zipkin.option.None;
        }
    }

    private static _makeMetadata(traceId: zipkin.TraceId): grpc.Metadata {
        const metadata = new grpc.Metadata();
        metadata.add(zipkin.HttpHeaders.TraceId, traceId.traceId);
        metadata.add(zipkin.HttpHeaders.ParentSpanId, traceId.parentId);
        metadata.add(zipkin.HttpHeaders.SpanId, traceId.spanId);
        metadata.add(zipkin.HttpHeaders.Sampled, traceId.sampled.getOrElse() ? '1' : '0');
        return metadata;
    }

    private static _replaceArguments(argus: IArguments, metadata: grpc.Metadata, callback: Function): IArguments {
        let i = 0;
        if (argus.length == 0) {
            argus[i] = metadata;
            argus.length++;
        } else {
            const oldArguments = Object.assign({}, argus);
            for (let key in oldArguments) {
                if (typeof oldArguments[key] == 'function') {
                    argus[i] = callback(oldArguments[key]);
                } else {
                    argus[i] = oldArguments[key];
                }
                if (parseInt(key) == 0) {
                    i++;
                    argus[i] = metadata;
                    argus.length++;
                }
                i++;
            }
        }

        return argus;
    }
}