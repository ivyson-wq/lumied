// ═══════════════════════════════════════════════════════════════
//  Edge Function: acesso (v3 — Onda 3 do refator)
//  Controle de acesso: Face Control ID (iDFace) + RFID + LPR
//  Quebrado em 10 handlers de domínio (era 4k linhas num arquivo só).
// ═══════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Router, rateLimit } from "../_shared/mod.ts";

import { register as registerDevices } from "./handlers/devices.ts";
import { register as registerFaces } from "./handlers/faces.ts";
import { register as registerRfid } from "./handlers/rfid.ts";
import { register as registerPermissions } from "./handlers/permissions.ts";
import { register as registerEvents } from "./handlers/events.ts";
import { register as registerTeacher } from "./handlers/teacher.ts";
import { register as registerFamily } from "./handlers/family.ts";
import { register as registerEnrollment } from "./handlers/enrollment.ts";
import { register as registerBridge } from "./handlers/bridge.ts";
import { register as registerLpr } from "./handlers/lpr.ts";

const router = new Router("acesso");
router.useGlobal(rateLimit());

registerDevices(router);
registerFaces(router);
registerRfid(router);
registerPermissions(router);
registerEvents(router);
registerTeacher(router);
registerFamily(router);
registerEnrollment(router);
registerBridge(router);
registerLpr(router);

serve(async (req) => {
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  return router.handle(req, sb);
});
