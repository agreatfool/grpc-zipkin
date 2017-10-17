"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const zipkin = require("zipkin");
const grpc = require("grpc");
const lib = require("./lib/lib");
class GrpcInstrumentation {
    static middleware(options) {
        const tracer = options.tracer;
        const serviceName = options.serviceName || 'unknown';
        const remoteServiceName = options.remoteServiceName || 'unknown';
        const port = options.port || 0;
        if (tracer === false) {
            return (ctx, next) => __awaiter(this, void 0, void 0, function* () {
                yield next();
            });
        }
        return (ctx, next) => __awaiter(this, void 0, void 0, function* () {
            const metadata = ctx.call.metadata;
            function readMetadata(headerName) {
                const val = lib.getMetadataValue(metadata, headerName)[0];
                if (val !== undefined) {
                    return new zipkin.option.Some(val);
                }
                else {
                    return zipkin.option.None;
                }
            }
            if (lib.containsIncomingMetadata(metadata)) {
                const spanId = readMetadata(zipkin.HttpHeaders.SpanId);
                spanId.ifPresent((sid) => {
                    const childId = new zipkin.TraceId({
                        traceId: readMetadata(zipkin.HttpHeaders.TraceId),
                        parentId: readMetadata(zipkin.HttpHeaders.ParentSpanId),
                        spanId: sid,
                        sampled: readMetadata(zipkin.HttpHeaders.Sampled).map(lib.stringToBoolean),
                        flags: readMetadata(zipkin.HttpHeaders.Flags).flatMap(lib.stringToIntOption).getOrElse(0)
                    });
                    tracer.setId(childId);
                });
            }
            else {
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
                }
                else {
                    tracer.setId(rootId);
                }
            }
            const traceId = tracer.id;
            tracer.scoped(() => {
                tracer.setId(traceId);
                tracer.recordServiceName(serviceName);
                tracer.recordRpc('rpc');
                tracer.recordAnnotation(new zipkin.Annotation.ServerRecv());
                tracer.recordAnnotation(new zipkin.Annotation.LocalAddr({ port }));
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
            yield next();
            tracer.scoped(() => {
                tracer.setId(traceId);
                tracer.recordAnnotation(new zipkin.Annotation.ServerSend());
            });
        });
    }
    static proxyClient(client, ctx, options) {
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
                                tracer.recordBinary('rpc_end', (err) ? `Error` : `Callback end`);
                                tracer.recordBinary('rpc_end_response', JSON.stringify((err) ? err : res));
                                tracer.recordAnnotation(new zipkin.Annotation.ClientRecv());
                            });
                            callback(err, res);
                        };
                    });
                    tracer.scoped(() => {
                        tracer.recordServiceName(serviceName);
                        tracer.recordRpc(`rpc`);
                        tracer.recordBinary('rpc_query', property);
                        tracer.recordBinary('rpc_query_params', JSON.stringify(arguments));
                        tracer.recordAnnotation(new zipkin.Annotation.ClientSend());
                        tracer.recordAnnotation(new zipkin.Annotation.LocalAddr({ port }));
                        if (traceId.flags !== 0 && traceId.flags != null) {
                            tracer.recordBinary(zipkin.HttpHeaders.Flags, traceId.flags.toString());
                        }
                    });
                    const call = original.apply(client, argus);
                    call.on('end', function () {
                        tracer.scoped(() => {
                            tracer.setId(traceId);
                            tracer.recordBinary('rpc_end', `Call end`);
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
exports.GrpcInstrumentation = GrpcInstrumentation;
//# sourceMappingURL=GrpcInstrumentation.js.map