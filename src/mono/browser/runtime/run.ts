// Licensed to the .NET Foundation under one or more agreements.
// The .NET Foundation licenses this file to you under the MIT license.

import MonoWasmThreads from "consts:monoWasmThreads";

import { ENVIRONMENT_IS_NODE, loaderHelpers, mono_assert, runtimeHelpers } from "./globals";
import { mono_wasm_wait_for_debugger } from "./debug";
import { mono_wasm_set_main_args } from "./startup";
import cwraps from "./cwraps";
import { mono_log_info } from "./logging";
import { assert_js_interop } from "./invoke-js";
import { assembly_load } from "./invoke-cs";
import { cancelThreads } from "./pthreads/browser";

/**
 * Possible signatures are described here  https://docs.microsoft.com/en-us/dotnet/csharp/fundamentals/program-structure/main-command-line
 */
export async function mono_run_main_and_exit(main_assembly_name?: string, args?: string[]): Promise<number> {
    try {
        const result = await mono_run_main(main_assembly_name, args);
        loaderHelpers.mono_exit(result);
        return result;
    } catch (error: any) {
        try {
            loaderHelpers.mono_exit(1, error);
        }
        catch (e) {
            // ignore
        }
        if (error && typeof error.status === "number") {
            return error.status;
        }
        return 1;
    }
}

/**
 * Possible signatures are described here  https://docs.microsoft.com/en-us/dotnet/csharp/fundamentals/program-structure/main-command-line
 */
export async function mono_run_main(main_assembly_name?: string, args?: string[]): Promise<number> {
    if (main_assembly_name === undefined || main_assembly_name === null || main_assembly_name === "") {
        main_assembly_name = loaderHelpers.config.mainAssemblyName;
        mono_assert(main_assembly_name, "Null or empty config.mainAssemblyName");
    }
    if (args === undefined || args === null) {
        args = runtimeHelpers.config.applicationArguments;
    }
    if (args === undefined || args === null) {
        if (ENVIRONMENT_IS_NODE) {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore:
            const process = await import(/*! webpackIgnore: true */"process");
            args = process.argv.slice(2) as string[];
        } else {
            args = [];
        }
    }

    mono_wasm_set_main_args(main_assembly_name, args);
    if (runtimeHelpers.waitForDebugger == -1) {
        mono_log_info("waiting for debugger...");
        await mono_wasm_wait_for_debugger();
    }
    const method = find_entry_point(main_assembly_name);

    const res = await runtimeHelpers.javaScriptExports.call_entry_point(method, args);

    // one more timer loop before we return, so that any remaining queued calls could run
    await new Promise(resolve => globalThis.setTimeout(resolve, 0));

    return res;
}

export function find_entry_point(assembly: string) {
    loaderHelpers.assert_runtime_running();
    assert_js_interop();
    const asm = assembly_load(assembly);
    if (!asm)
        throw new Error("Could not find assembly: " + assembly);

    let auto_set_breakpoint = 0;
    if (runtimeHelpers.waitForDebugger == 1)
        auto_set_breakpoint = 1;

    const method = cwraps.mono_wasm_assembly_get_entry_point(asm, auto_set_breakpoint);
    if (!method)
        throw new Error("Could not find entry point for assembly: " + assembly);
    return method;
}

export function nativeExit(code: number) {
    if (MonoWasmThreads) {
        cancelThreads();
    }
    cwraps.mono_wasm_exit(code);
}

export function nativeAbort(reason: any) {
    loaderHelpers.exitReason = reason;
    if (!loaderHelpers.is_exited()) {
        cwraps.mono_wasm_abort();
    }
    throw reason;
}