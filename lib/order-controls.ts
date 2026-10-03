import { controlKinds, ControlKind, Order } from "./beta";
export function configureControls(
  previous: Order["controls"],
  settings: Record<string, { enabled: boolean }> | undefined,
  labels?: string,
  reset = false,
): NonNullable<Order["controls"]> {
  const result: NonNullable<Order["controls"]> = {};
  for (const k of controlKinds) {
    const old = previous?.[k];
    const enabled = settings?.[k]?.enabled ?? old?.enabled ?? false;
    const items = (old?.items || []).map((i) =>
      reset ? { id: i.id, label: i.label, done: false, comment: "" } : { ...i },
    );
    if (k === "self" && labels !== undefined)
      for (const label of labels
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean))
        if (!items.some((i) => i.label === label))
          items.push({
            id: crypto.randomUUID(),
            label,
            done: false,
            comment: "",
          });
    if (enabled && !items.length) {
      if (k === "self") throw Error("Lägg till minst en egenkontrollpunkt.");
      items.push({
        id: crypto.randomUUID(),
        label:
          k === "risk" ? "Riskbedömning dokumenterad" : "Slutkontroll utförd",
        done: false,
        comment: "",
      });
    }
    result[k] = { enabled, items };
  }
  return result;
}
