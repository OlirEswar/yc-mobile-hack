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
import type * as chronicle from "../chronicle.js";
import type * as cognition from "../cognition.js";
import type * as cognition_budget from "../cognition/budget.js";
import type * as cognition_context from "../cognition/context.js";
import type * as cognition_prompt from "../cognition/prompt.js";
import type * as cognition_provider from "../cognition/provider.js";
import type * as cognition_validate from "../cognition/validate.js";
import type * as engine_core from "../engine/core.js";
import type * as engine_loop from "../engine/loop.js";
import type * as http from "../http.js";
import type * as interventions from "../interventions.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_constants from "../lib/constants.js";
import type * as lib_public from "../lib/public.js";
import type * as lib_rng from "../lib/rng.js";
import type * as powers_arrival from "../powers/arrival.js";
import type * as powers_colonists from "../powers/colonists.js";
import type * as powers_common from "../powers/common.js";
import type * as powers_environment from "../powers/environment.js";
import type * as powers_ideas from "../powers/ideas.js";
import type * as powers_index from "../powers/index.js";
import type * as seed_build from "../seed/build.js";
import type * as seed_insert from "../seed/insert.js";
import type * as seed_keyCharacters from "../seed/keyCharacters.js";
import type * as seed_names from "../seed/names.js";
import type * as session from "../session.js";
import type * as sim from "../sim.js";
import type * as sync from "../sync.js";
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
  chronicle: typeof chronicle;
  cognition: typeof cognition;
  "cognition/budget": typeof cognition_budget;
  "cognition/context": typeof cognition_context;
  "cognition/prompt": typeof cognition_prompt;
  "cognition/provider": typeof cognition_provider;
  "cognition/validate": typeof cognition_validate;
  "engine/core": typeof engine_core;
  "engine/loop": typeof engine_loop;
  http: typeof http;
  interventions: typeof interventions;
  "lib/auth": typeof lib_auth;
  "lib/constants": typeof lib_constants;
  "lib/public": typeof lib_public;
  "lib/rng": typeof lib_rng;
  "powers/arrival": typeof powers_arrival;
  "powers/colonists": typeof powers_colonists;
  "powers/common": typeof powers_common;
  "powers/environment": typeof powers_environment;
  "powers/ideas": typeof powers_ideas;
  "powers/index": typeof powers_index;
  "seed/build": typeof seed_build;
  "seed/insert": typeof seed_insert;
  "seed/keyCharacters": typeof seed_keyCharacters;
  "seed/names": typeof seed_names;
  session: typeof session;
  sim: typeof sim;
  sync: typeof sync;
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
