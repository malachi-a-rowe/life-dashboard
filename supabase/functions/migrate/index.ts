// migrate — one-time (safe to repeat) copy of the ld_v10 JSON blob into the
// real tables. Reads the caller's row from `dashboard`, maps each collection,
// and upserts so running twice never duplicates.
//
// It does NOT delete the blob. The app keeps syncing to `dashboard` until the
// full cut-over; this only mirrors data forward.

import { handler, json, HttpError } from "../_shared/http.ts";

// Small helpers ───────────────────────────────────────────────
const num = (v: unknown, d = 0) => {
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : d;
};
const str = (v: unknown, d = "") => (v == null ? d : String(v));
// Legacy dates are stored like "Jul 13" / "2026-05-04". Normalise to YYYY-MM-DD.
function toDate(v: unknown): string {
  const s = str(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s.match(/\d{4}/) ? s : `${s} ${new Date().getFullYear()}`);
  return Number.isNaN(d.getTime())
    ? new Date().toISOString().slice(0, 10)
    : d.toISOString().slice(0, 10);
}

Deno.serve(handler(async (req, { userId, client }) => {
  const origin = req.headers.get("origin");

  // Read the caller's blob.
  const { data: row, error } = await client
    .from("dashboard").select("data").eq("user_id", userId).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  const st = (row?.data ?? {}) as Record<string, any>;
  if (!Object.keys(st).length) {
    return json({ ok: false, reason: "No blob found for this user — sync first." }, 200, origin);
  }

  const counts: Record<string, number> = {};
  const errors: string[] = [];
  const up = async (table: string, rows: any[], onConflict: string) => {
    if (!rows.length) { counts[table] = 0; return; }
    const { error } = await client.from(table).upsert(rows, { onConflict });
    if (error) errors.push(`${table}: ${error.message}`);
    counts[table] = error ? 0 : rows.length;
  };
  const up1 = async (table: string, rowObj: any, onConflict: string) => {
    const { error } = await client.from(table).upsert(rowObj, { onConflict });
    if (error) errors.push(`${table}: ${error.message}`);
    counts[table] = error ? 0 : 1;
  };

  // profile ──────────────────────────────────────────────
  await up1("profiles", {
    id: userId,
    body_weight: st.bodyWt != null ? num(st.bodyWt) : null,
    theme: str(st.theme, "field"),
  }, "id");

  // accounts ─────────────────────────────────────────────
  const order: string[] = st.accountOrder ?? Object.keys(st.accounts ?? {});
  await up("accounts", Object.entries(st.accounts ?? {}).map(([name, a]: any, i) => ({
    user_id: userId,
    name,
    type: str(a.type, "Cash"),
    start_bal: num(a.startBal),
    sort_order: order.indexOf(name) >= 0 ? order.indexOf(name) : i,
    is_hidden: !!a.hidden,
  })), "user_id,name");

  // transactions — external_id makes re-runs and Plaid idempotent ─
  await up("transactions", (st.transactions ?? []).map((t: any, i: number) => ({
    user_id: userId,
    occurred_on: toDate(t.dt),
    account: str(t.ac),
    description: str(t.ds),
    category: str(t.ct, "Other"),
    kind: str(t.tp, "Expense"),
    amount: num(t.am),
    transfer_account: t.tac ?? null,
    bucket: t.bucket ?? null,
    external_id: t.id ? `blob:${t.id}` : `blob:idx:${i}`,
  })), "user_id,external_id");

  // savings buckets ──────────────────────────────────────
  await up("savings_buckets", (st.savings ?? []).map((s: any) => ({
    user_id: userId,
    name: str(s.name),
    goal: num(s.goal),
    start_amt: num(s.startAmt),
    manual_current: num(s.current),
    monthly: num(s.monthly),
    is_percent: !!s.isPercent,
  })), "user_id,name");

  // budgets ──────────────────────────────────────────────
  await up("budgets", (st.budgets ?? []).map((b: any) => ({
    user_id: userId,
    category: str(b.cat ?? b.category ?? b.name),
    planned: num(b.planned ?? b.amt),
  })).filter((b: any) => b.category), "user_id,category");

  // finance plan (kept whole) ────────────────────────────
  if (st.finPlan) {
    await up1("finance_plans", { user_id: userId, data: st.finPlan }, "user_id");
  }

  // personal records / maxes ─────────────────────────────
  await up("personal_records", Object.entries(st.ms ?? {})
    .filter(([, m]: any) => m && typeof m === "object" && ("c" in m || "g" in m))
    .map(([metric, m]: any) => ({
      user_id: userId,
      metric,
      current_val: m.c != null ? num(m.c) : null,
      goal_val: m.g != null ? num(m.g) : null,
      unit: m.u ?? null,
    })), "user_id,metric");

  // plan state ───────────────────────────────────────────
  if (st.plan) {
    await up1("plan_state", {
      user_id: userId,
      program: st.plan.prog ?? null,
      phase_idx: num(st.plan.ph),
      week: num(st.plan.wk, 1),
      day_idx: num(st.plan.day),
    }, "user_id");
  }

  // workouts + their sets ────────────────────────────────
  let setCount = 0;
  for (const w of (st.workouts ?? [])) {
   try {
    const { data: wr, error: we } = await client.from("workouts").upsert({
      id: w.id && /^[0-9a-f-]{36}$/i.test(w.id) ? w.id : undefined,
      user_id: userId,
      performed_on: toDate(w.dt),
      name: str(w.nm),
      duration_min: w.dur ? num(w.dur) : null,
      notes: str(w.notes),
      warm_done: !!w.warmDn, cool_done: !!w.coolDn, mobility_done: !!w.mobDn,
    }, { onConflict: "id" }).select("id").single();
    if (we || !wr) { errors.push(`workout: ${we?.message}`); continue; }

    const sets = (w.exs ?? []).flatMap((ex: any) =>
      (ex.sets ?? []).map((s: any, si: number) => ({
        workout_id: wr.id, user_id: userId,
        exercise: str(ex.n ?? ex.name), block: ex.g ?? ex.block ?? null,
        set_index: si, reps: str(s.r), duration: str(s.t),
        weight: s.w ? num(s.w) : null, rpe: s.rpe ? num(s.rpe) : null,
        completed: !!s.done,
      })));
    if (sets.length) {
      // clear any prior sets for this workout, then insert fresh (keeps re-runs clean)
      await client.from("workout_sets").delete().eq("workout_id", wr.id);
      const { error: se } = await client.from("workout_sets").insert(sets);
      if (se) errors.push(`sets: ${se.message}`); else setCount += sets.length;
    }
   } catch (e) { errors.push(`workout row: ${e instanceof Error ? e.message : String(e)}`); }
  }
  counts["workouts"] = (st.workouts ?? []).length;
  counts["workout_sets"] = setCount;

  // habits + logs ────────────────────────────────────────
  const habitDefs = st.habitDefs ?? st.habits ?? [];
  await up("habits", habitDefs.map((h: any, i: number) => ({
    user_id: userId,
    name: str(h.name ?? h.label ?? h),
    cadence: str(h.cadence ?? h.freq, "daily"),
    sort_order: i,
    archived: !!h.archived,
  })).filter((h: any) => h.name), "user_id,name");

  // goals ────────────────────────────────────────────────
  await up("goals", (st.goals ?? []).map((g: any) => ({
    user_id: userId,
    area: g.area ?? null,
    name: str(g.name ?? g.title),
    target: g.target != null ? String(g.target) : null,
    due_on: g.due ? toDate(g.due) : null,
    progress: num(g.progress),
    done: !!g.done,
  })).filter((g: any) => g.name), "user_id,name");

  return json({ ok: errors.length === 0, counts, errors }, 200, origin);
}));
