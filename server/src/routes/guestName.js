import { z } from "zod";

// The display name a guest picks before playing. Same messages as the
// profile name in users.js, so the client already has translations for them.
export const GuestNameSchema = z.string().trim()
  .min(1, "Name too short")
  .max(30, "Name too long");
