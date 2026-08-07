/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as cleanup from "../cleanup.js";
import type * as crons from "../crons.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_finishedRendition from "../lib/finishedRendition.js";
import type * as lib_tokens from "../lib/tokens.js";
import type * as lib_videoTimeline from "../lib/videoTimeline.js";
import type * as multipartUploadData from "../multipartUploadData.js";
import type * as multipartUploads from "../multipartUploads.js";
import type * as r2 from "../r2.js";
import type * as videoActions from "../videoActions.js";
import type * as videoAssets from "../videoAssets.js";
import type * as videoFlowV2 from "../videoFlowV2.js";
import type * as videoFlowV2Actions from "../videoFlowV2Actions.js";
import type * as videoPasswordData from "../videoPasswordData.js";
import type * as videoPasswords from "../videoPasswords.js";
import type * as videoShareData from "../videoShareData.js";
import type * as videoShares from "../videoShares.js";
import type * as videoTranscription from "../videoTranscription.js";
import type * as videos from "../videos.js";
import type * as videosPublic from "../videosPublic.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  cleanup: typeof cleanup;
  crons: typeof crons;
  "lib/auth": typeof lib_auth;
  "lib/finishedRendition": typeof lib_finishedRendition;
  "lib/tokens": typeof lib_tokens;
  "lib/videoTimeline": typeof lib_videoTimeline;
  multipartUploadData: typeof multipartUploadData;
  multipartUploads: typeof multipartUploads;
  r2: typeof r2;
  videoActions: typeof videoActions;
  videoAssets: typeof videoAssets;
  videoFlowV2: typeof videoFlowV2;
  videoFlowV2Actions: typeof videoFlowV2Actions;
  videoPasswordData: typeof videoPasswordData;
  videoPasswords: typeof videoPasswords;
  videoShareData: typeof videoShareData;
  videoShares: typeof videoShares;
  videoTranscription: typeof videoTranscription;
  videos: typeof videos;
  videosPublic: typeof videosPublic;
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

export declare const components: {
  r2: import("@convex-dev/r2/_generated/component.js").ComponentApi<"r2">;
};
