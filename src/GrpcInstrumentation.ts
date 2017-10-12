import * as zipkin from 'zipkin';
import * as grpc from 'grpc';
import {MiddlewareNext, RpcContext, RpcMiddleware, GatewayContext} from 'sasdn';
import * as lib from './lib/lib';

export interface MiddlewareOptions {
    tracer: zipkin.Tracer;
    serviceName?: string;
    remoteServiceName?: string;
    port?: number;
}

export class GrpcInstrumentation {
    public static middleware(options: MiddlewareOptions): RpcMiddleware {
        const tracer = options.tracer;
        const serviceName = options.serviceName || 'unknown';
        const remoteServiceName = options.remoteServiceName || 'unknown';
        const port = options.port || 0;

        if (tracer === false) {
            return async (ctx: RpcContext, next: MiddlewareNext) => {
                await next();
            };
        }

        return async (ctx: RpcContext, next: MiddlewareNext) => {
            const metadata = ctx.call.metadata as grpc.Metadata;

            function readMetadata(headerName: string) {
                const val = lib.getMetadataValue(metadata, headerName)[0];
                if (val !== undefined) {
                    return new zipkin.option.Some(val);
                } else {
                    return zipkin.option.None;
                }
            }

            if (lib.containsIncomingMetadata(metadata)) {
                const spanId = readMetadata(zipkin.HttpHeaders.SpanId);
                spanId.ifPresent((sid: zipkin.spanId) => {
                    const childId = new zipkin.TraceId({
                        traceId: readMetadata(zipkin.HttpHeaders.TraceId),
                        parentId: readMetadata(zipkin.HttpHeaders.ParentSpanId),
                        spanId: sid,
                        sampled: readMetadata(zipkin.HttpHeaders.Sampled).map(lib.stringToBoolean),
                        flags: readMetadata(zipkin.HttpHeaders.Flags).flatMap(lib.stringToIntOption).getOrElse(0)
                    });
                    tracer.setId(childId);
                });
            } else {
                const rootId = tracer.createRootId();
                if (lib.getMetadataValue(metadata, zipkin.HttpHeaders.Flags)[0]) {
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
        const serviceName = options.serviceName || 'unknown';
        const port = options.port || 0;

        if (tracer === false) {
            return client;
        }

        if (ctx
            && ctx.hasOwnProperty(zipkin.HttpHeaders.TraceId)
            && ctx[zipkin.HttpHeaders.TraceId] instanceof zipkin.TraceId) {
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

                    const metadata = lib.makeMetadata(traceId);
                    const argus = lib.replaceArguments(arguments, metadata, (callback) => {
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
}
