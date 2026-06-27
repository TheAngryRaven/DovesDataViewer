// Projects a user's opt-in vehicles to the public_vehicles table (plan 0006).
//
// Vehicles back up privately to sync_records like every garage record; this is a
// SECOND, public-safe projection driven off the same garage-change event. Only
// vehicles flagged `publicProfile` are published, and only public-safe columns
// (name/type/engine/number) — never weight or any setup. Unflagging or deleting
// a vehicle removes its public row. Best-effort: a failed projection is logged,
// not retried (it self-heals on the next vehicle edit), so it never blocks the
// authoritative private backup.

import type { GarageChange } from "@/lib/garageEvents";
import { getVehicle } from "@/lib/vehicleStorage";
import { getVehicleType } from "@/lib/templateStorage";
import { publicVehicles } from "./cloudClient";

async function removePublicVehicle(userId: string, vehicleId: string): Promise<void> {
  const { error } = await publicVehicles()
    .delete()
    .eq("user_id", userId)
    .eq("vehicle_id", vehicleId);
  if (error) throw new Error(error.message);
}

/** Mirror one garage vehicle change into the public projection (best-effort). */
export async function syncPublicVehicle(userId: string, change: GarageChange): Promise<void> {
  try {
    if (change.type === "delete") {
      await removePublicVehicle(userId, change.key);
      return;
    }
    const vehicle = await getVehicle(change.key);
    // Gone, or opted out → ensure no public row lingers.
    if (!vehicle || !vehicle.publicProfile) {
      await removePublicVehicle(userId, change.key);
      return;
    }
    const type = vehicle.vehicleTypeId ? await getVehicleType(vehicle.vehicleTypeId) : null;
    const { error } = await publicVehicles().upsert({
      user_id: userId,
      vehicle_id: vehicle.id,
      name: vehicle.name,
      type_name: type?.name ?? null,
      engine: vehicle.engine,
      number: vehicle.number,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
  } catch (err) {
    console.error("public vehicle projection failed", err);
  }
}
