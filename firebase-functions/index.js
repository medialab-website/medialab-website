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
import listDriveFolderHandler from "../netlify/functions/list-drive-folder.mjs";

// Define Secrets and Params preserving existing configuration names
const ARYEO_API_KEY = defineSecret("ARYEO_API_KEY");
const OPENROUTESERVICE_API_KEY = defineSecret("OPENROUTESERVICE_API_KEY");
const MEDIALAB_ROUTE_ORIGIN = defineString("MEDIALAB_ROUTE_ORIGIN");
const GOOGLE_DRIVE_FOLDER_ID = defineString("GOOGLE_DRIVE_FOLDER_ID");

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
  { ...baseOpts, secrets: [OPENROUTESERVICE_API_KEY] },
  createHandler(getExitRouteHandler)
);

export const listDriveFolder = onRequest(
  baseOpts,
  createHandler(listDriveFolderHandler)
);
