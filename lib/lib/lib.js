"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const zipkin = require("zipkin");
const grpc = require("grpc");
function getMetadataValue(metadata, headerName) {
    if (metadata.get(headerName) !== undefined) {
        return metadata.get(headerName);
    }
    if (metadata.get(headerName.toLowerCase()) !== undefined) {
        return metadata.get(headerName.toLowerCase());
    }
    if (metadata.get(headerName.toUpperCase()) !== undefined) {
        return metadata.get(headerName.toUpperCase());
    }
    return null;
}
exports.getMetadataValue = getMetadataValue;
function containsIncomingMetadata(metadata) {
    return getMetadataValue(metadata, zipkin.HttpHeaders.TraceId)[0] !== undefined
        && getMetadataValue(metadata, zipkin.HttpHeaders.SpanId)[0] !== undefined;
}
exports.containsIncomingMetadata = containsIncomingMetadata;
function stringToBoolean(str) {
    return str === '1';
}
exports.stringToBoolean = stringToBoolean;
function stringToIntOption(str) {
    try {
        return new zipkin.option.Some(parseInt(str));
    }
    catch (err) {
        return zipkin.option.None;
    }
}
exports.stringToIntOption = stringToIntOption;
function makeMetadata(traceId) {
    const metadata = new grpc.Metadata();
    metadata.add(zipkin.HttpHeaders.TraceId, traceId.traceId);
    metadata.add(zipkin.HttpHeaders.ParentSpanId, traceId.parentId);
    metadata.add(zipkin.HttpHeaders.SpanId, traceId.spanId);
    metadata.add(zipkin.HttpHeaders.Sampled, traceId.sampled.getOrElse() ? '1' : '0');
    return metadata;
}
exports.makeMetadata = makeMetadata;
function replaceArguments(argus, metadata, callback) {
    let i = 0;
    if (argus.length == 0) {
        argus[i] = metadata;
        argus.length++;
    }
    else {
        const oldArguments = Object.assign({}, argus);
        for (let key in oldArguments) {
            if (typeof oldArguments[key] == 'function') {
                argus[i] = callback(oldArguments[key]);
            }
            else {
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
exports.replaceArguments = replaceArguments;
//# sourceMappingURL=lib.js.map