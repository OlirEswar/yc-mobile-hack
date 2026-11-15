import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

export const list = queryGeneric({
  args: {},
  handler: async (ctx) => ctx.db.query("items").order("desc").collect(),
});

export const add = mutationGeneric({
  args: { text: v.string() },
  handler: async (ctx, { text }) => ctx.db.insert("items", { text }),
});
