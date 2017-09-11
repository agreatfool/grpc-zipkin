import * as zipkin from "zipkin";
import {RpcContext, RpcMiddleware, GatewayContext} from "sasdn";

export interface MiddlewareOptions {
    tracer: zipkin.Tracer;
    serviceName?: string;
    port?: number;
    remoteServiceName?: string;
}

export declare class GrpcInstrumentation {
    public static middleware(options: MiddlewareOptions): RpcMiddleware;

    public static proxyClient<T>(client: T, ctx: GatewayContext | RpcContext, options: MiddlewareOptions): T;
}