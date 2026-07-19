/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as http from "../http.js";
import type * as lib_completion_binding from "../lib/completion_binding.js";
import type * as lib_persist_analysis from "../lib/persist_analysis.js";
import type * as lib_token_scope from "../lib/token_scope.js";
import type * as management from "../management.js";
import type * as runs from "../runs.js";
import type * as start from "../start.js";
import type * as waitlist from "../waitlist.js";
import type * as worker from "../worker.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  http: typeof http;
  "lib/completion_binding": typeof lib_completion_binding;
  "lib/persist_analysis": typeof lib_persist_analysis;
  "lib/token_scope": typeof lib_token_scope;
  management: typeof management;
  runs: typeof runs;
  start: typeof start;
  waitlist: typeof waitlist;
  worker: typeof worker;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
