import { onRequest } from "firebase-functions/v2/https";
import { defineSecret, defineString } from "firebase-functions/params";
import { createHandler } from "./adapter.js";

// Initialize Firebase Admin using Application Default Credentials
import { initializeApp } from "firebase-admin/app";
initializeApp();

// Import original Netlify handlers (canonical business logic)
import verifyUserHandler from "../netlify/functions/verify-user.mjs";
import getAryeoOrdersHandler from "../netlify/functions/get-aryeo-orders.mjs";
import getAryeoOrderDetailHandler from "../netlify/functions/get-aryeo-order-detail.mjs";
import getMissionPlanHandler from "../netlify/functions/get-mission-plan.mjs";
import getExitRouteHandler from "../netlify/functions/get-exit-route.mjs";

// Import Shared Drive Core for Firebase adapter
import { executeDriveList } from "../netlify/functions/_shared/drive-core.mjs";
import authModule from "../netlify/functions/_shared/auth.js";
const { verifyAuth } = authModule;
import { google } from "googleapis";

// Define Secrets and Params preserving existing configuration names
const ARYEO_API_KEY = defineSecret("ARYEO_API_KEY");
const OPENROUTESERVICE_API_KEY = defineSecret("OPENROUTESERVICE_API_KEY");
const MEDIALAB_ROUTE_ORIGIN = defineString("MEDIALAB_ROUTE_ORIGIN");
const GOOGLE_DRIVE_FOLDER_ID = defineString("GOOGLE_DRIVE_FOLDER_ID");
const MEDIALAB_I81_EXIT1_NB_ENTRY_COORDS = defineString("MEDIALAB_I81_EXIT1_NB_ENTRY_COORDS");
const MEDIALAB_I81_EXIT1A_SB_RETURN_COORDS = defineString("MEDIALAB_I81_EXIT1A_SB_RETURN_COORDS");

// Function options mapping defaults
const baseOpts = { region: "us-east1" };

export const verifyUser = onRequest(
  baseOpts,
  createHandler(verifyUserHandler)
);

export const getAryeoOrders = onRequest(
  { ...baseOpts, secrets: [ARYEO_API_KEY] },
  createHandler(getAryeoOrdersHandler)
);

export const getAryeoOrderDetail = onRequest(
  { ...baseOpts, secrets: [ARYEO_API_KEY] },
  createHandler(getAryeoOrderDetailHandler)
);

export const getMissionPlan = onRequest(
  { ...baseOpts, secrets: [ARYEO_API_KEY, OPENROUTESERVICE_API_KEY] },
  createHandler(getMissionPlanHandler)
);

export const getExitRoute = onRequest(
  { ...baseOpts, secrets: [OPENROUTESERVICE_API_KEY, ARYEO_API_KEY] },
  createHandler(getExitRouteHandler)
);

// Firebase specific adapter for listDriveFolder using ADC
async function firebaseListDriveFolderHandler(req, context) {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
  }

  const authResult = await verifyAuth(req);
  if (!authResult.ok) {
    return new Response(JSON.stringify({ error: authResult.error }), { status: authResult.statusCode, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const folderId = GOOGLE_DRIVE_FOLDER_ID.value();
    if (!folderId) {
      console.error('Missing Drive server configuration: GOOGLE_DRIVE_FOLDER_ID');
      return new Response(JSON.stringify({ error: 'Server configuration error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/drive.metadata.readonly']
    });

    const drive = google.drive({ version: 'v3', auth });

    const result = await executeDriveList(drive, folderId);

    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    const status = error.message === 'Server configuration error: missing folder ID' ? 500 : 502;
    return new Response(JSON.stringify({ error: error.message || 'Upstream API failure' }), { status, headers: { 'Content-Type': 'application/json' } });
  }
}

export const listDriveFolder = onRequest(
  baseOpts,
  createHandler(firebaseListDriveFolderHandler)
);
