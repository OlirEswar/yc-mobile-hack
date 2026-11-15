/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as agents from "../agents.js";
import type * as billing from "../billing.js";
import type * as engine_loop from "../engine/loop.js";
import type * as http from "../http.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_constants from "../lib/constants.js";
import type * as lib_public from "../lib/public.js";
import type * as lib_rng from "../lib/rng.js";
import type * as seed_build from "../seed/build.js";
import type * as seed_insert from "../seed/insert.js";
import type * as seed_keyCharacters from "../seed/keyCharacters.js";
import type * as seed_names from "../seed/names.js";
import type * as session from "../session.js";
import type * as sim from "../sim.js";
import type * as world from "../world.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  agents: typeof agents;
  billing: typeof billing;
  "engine/loop": typeof engine_loop;
  http: typeof http;
  "lib/auth": typeof lib_auth;
  "lib/constants": typeof lib_constants;
  "lib/public": typeof lib_public;
  "lib/rng": typeof lib_rng;
  "seed/build": typeof seed_build;
  "seed/insert": typeof seed_insert;
  "seed/keyCharacters": typeof seed_keyCharacters;
  "seed/names": typeof seed_names;
  session: typeof session;
  sim: typeof sim;
  world: typeof world;
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
