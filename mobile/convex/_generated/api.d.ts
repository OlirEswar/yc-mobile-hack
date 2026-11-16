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
import type * as engine_act from "../engine/act.js";
import type * as engine_arcs from "../engine/arcs.js";
import type * as engine_bonds from "../engine/bonds.js";
import type * as engine_collective from "../engine/collective.js";
import type * as engine_conditions from "../engine/conditions.js";
import type * as engine_core from "../engine/core.js";
import type * as engine_council from "../engine/council.js";
import type * as engine_desires from "../engine/desires.js";
import type * as engine_devtools from "../engine/devtools.js";
import type * as engine_executor from "../engine/executor.js";
import type * as engine_intrigue from "../engine/intrigue.js";
import type * as engine_ledger from "../engine/ledger.js";
import type * as engine_livelihood from "../engine/livelihood.js";
import type * as engine_loop from "../engine/loop.js";
import type * as engine_needs from "../engine/needs.js";
import type * as engine_people from "../engine/people.js";
import type * as engine_plan from "../engine/plan.js";
import type * as engine_planner from "../engine/planner.js";
import type * as engine_secrets from "../engine/secrets.js";
import type * as engine_social from "../engine/social.js";
import type * as engine_state from "../engine/state.js";
import type * as engine_step from "../engine/step.js";
import type * as engine_strategies from "../engine/strategies.js";
import type * as engine_systems from "../engine/systems.js";
import type * as engine_text from "../engine/text.js";
import type * as focus from "../focus.js";
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
import type * as seed_personas from "../seed/personas.js";
import type * as seed_worldBible from "../seed/worldBible.js";
import type * as session from "../session.js";
import type * as sim from "../sim.js";
import type * as society_api from "../society/api.js";
import type * as society_choices from "../society/choices.js";
import type * as society_craft from "../society/craft.js";
import type * as society_culture from "../society/culture.js";
import type * as society_detail from "../society/detail.js";
import type * as society_events from "../society/events.js";
import type * as society_family from "../society/family.js";
import type * as society_hooks from "../society/hooks.js";
import type * as society_obsession from "../society/obsession.js";
import type * as society_orgs from "../society/orgs.js";
import type * as society_seed from "../society/seed.js";
import type * as society_steps from "../society/steps.js";
import type * as society_store from "../society/store.js";
import type * as society_validate from "../society/validate.js";
import type * as society_work from "../society/work.js";
import type * as story from "../story.js";
import type * as storyteller_director from "../storyteller/director.js";
import type * as storyteller_hooks from "../storyteller/hooks.js";
import type * as storyteller_monologue from "../storyteller/monologue.js";
import type * as storyteller_plant from "../storyteller/plant.js";
import type * as storyteller_prose from "../storyteller/prose.js";
import type * as storyteller_spotlight from "../storyteller/spotlight.js";
import type * as storyteller_storylines from "../storyteller/storylines.js";
import type * as sync from "../sync.js";
import type * as timeskip from "../timeskip.js";
import type * as timeskip_effects from "../timeskip/effects.js";
import type * as timeskip_llm from "../timeskip/llm.js";
import type * as timeskip_model from "../timeskip/model.js";
import type * as timeskip_rules from "../timeskip/rules.js";
import type * as timeskip_spans from "../timeskip/spans.js";
import type * as timeskip_stories from "../timeskip/stories.js";
import type * as timeskip_summary from "../timeskip/summary.js";
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
  "engine/act": typeof engine_act;
  "engine/arcs": typeof engine_arcs;
  "engine/bonds": typeof engine_bonds;
  "engine/collective": typeof engine_collective;
  "engine/conditions": typeof engine_conditions;
  "engine/core": typeof engine_core;
  "engine/council": typeof engine_council;
  "engine/desires": typeof engine_desires;
  "engine/devtools": typeof engine_devtools;
  "engine/executor": typeof engine_executor;
  "engine/intrigue": typeof engine_intrigue;
  "engine/ledger": typeof engine_ledger;
  "engine/livelihood": typeof engine_livelihood;
  "engine/loop": typeof engine_loop;
  "engine/needs": typeof engine_needs;
  "engine/people": typeof engine_people;
  "engine/plan": typeof engine_plan;
  "engine/planner": typeof engine_planner;
  "engine/secrets": typeof engine_secrets;
  "engine/social": typeof engine_social;
  "engine/state": typeof engine_state;
  "engine/step": typeof engine_step;
  "engine/strategies": typeof engine_strategies;
  "engine/systems": typeof engine_systems;
  "engine/text": typeof engine_text;
  focus: typeof focus;
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
  "seed/personas": typeof seed_personas;
  "seed/worldBible": typeof seed_worldBible;
  session: typeof session;
  sim: typeof sim;
  "society/api": typeof society_api;
  "society/choices": typeof society_choices;
  "society/craft": typeof society_craft;
  "society/culture": typeof society_culture;
  "society/detail": typeof society_detail;
  "society/events": typeof society_events;
  "society/family": typeof society_family;
  "society/hooks": typeof society_hooks;
  "society/obsession": typeof society_obsession;
  "society/orgs": typeof society_orgs;
  "society/seed": typeof society_seed;
  "society/steps": typeof society_steps;
  "society/store": typeof society_store;
  "society/validate": typeof society_validate;
  "society/work": typeof society_work;
  story: typeof story;
  "storyteller/director": typeof storyteller_director;
  "storyteller/hooks": typeof storyteller_hooks;
  "storyteller/monologue": typeof storyteller_monologue;
  "storyteller/plant": typeof storyteller_plant;
  "storyteller/prose": typeof storyteller_prose;
  "storyteller/spotlight": typeof storyteller_spotlight;
  "storyteller/storylines": typeof storyteller_storylines;
  sync: typeof sync;
  timeskip: typeof timeskip;
  "timeskip/effects": typeof timeskip_effects;
  "timeskip/llm": typeof timeskip_llm;
  "timeskip/model": typeof timeskip_model;
  "timeskip/rules": typeof timeskip_rules;
  "timeskip/spans": typeof timeskip_spans;
  "timeskip/stories": typeof timeskip_stories;
  "timeskip/summary": typeof timeskip_summary;
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
