import * as zipkin from "zipkin";
import * as grpc from "grpc";

export function getMetadataValue(metadata: grpc.Metadata, headerName: string): Array<string> {
    // metadata.get() 方法本身就是不区分大小写的，eg：X-B3-TraceId 和 x-b3-traceid 可以获取相同的数据
    return metadata.get(headerName);
}

export function containsIncomingMetadata(metadata: grpc.Metadata): boolean {
    return getMetadataValue(metadata, zipkin.HttpHeaders.TraceId)[0] !== undefined
        && getMetadataValue(metadata, zipkin.HttpHeaders.SpanId)[0] !== undefined;
}

export function stringToBoolean(str: string): boolean {
    return str === '1';
}

export function stringToIntOption(str: string): any {
    try {
        return new zipkin.option.Some(parseInt(str));
    } catch (err) {
        return zipkin.option.None;
    }
}

export function makeMetadata(traceId: zipkin.TraceId): grpc.Metadata {
    const metadata = new grpc.Metadata();
    metadata.add(zipkin.HttpHeaders.TraceId, traceId.traceId);
    metadata.add(zipkin.HttpHeaders.ParentSpanId, traceId.parentId);
    metadata.add(zipkin.HttpHeaders.SpanId, traceId.spanId);
    metadata.add(zipkin.HttpHeaders.Sampled, traceId.sampled.getOrElse() ? '1' : '0');
    return metadata;
}

export function replaceArguments(argus: IArguments, metadata: grpc.Metadata, callback: Function): IArguments {
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