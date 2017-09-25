# zipkin-instrumentation-grpcjs

SASDN grpc middleware and instrumentation that adds Zipkin tracing to the application.

## SASDN Grpc Middleware

```typescript
import {RpcApplication} from "sasdn";
import * as grpcInstrumentation from "zipkin-instrumentation-grpcjs";
import {Tracer, ExplicitContext, ConsoleRecorder} from "zipkin";

const ctxImpl = new ExplicitContext();
const recorder = new ConsoleRecorder();
const tracer = new Tracer({ctxImpl, recorder}); // configure your tracer properly here

const app = new RpcApplication();

// Add the Zipkin middleware
app.use(GrpcInstrumentation.middleware({tracer}));
```

### Grpc Client Proxy

This library will wrap grpc client proxy to add metadata and record traces.

```typescript
import * as grpc from "grpc";
import {GatewayContext, RpcContext} from "sasdn";
import * as grpcInstrumentation from "zipkin-instrumentation-grpcjs";
import {Tracer, ExplicitContext, ConsoleRecorder} from "zipkin";

import {OrderServiceClient} from "./proto/order/order_grpc_pb";

const ctxImpl = new ExplicitContext();
const recorder = new ConsoleRecorder();
const tracer = new Tracer({ctxImpl, recorder}); // configure your tracer properly here

export default class GrpcClientOrder {
    public client: OrderServiceClient;

    constructor(ctx?: GatewayContext | RpcContext) {
        this.client = GrpcInstrumentation.proxyClient(
            new OrderServiceClient('127.0.0.1:9090', grpc.credentials.createInsecure()),
            ctx,
            {tracer}
        );
    }

}
```