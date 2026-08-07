/* eslint-disable */
/** Generated API types. Regenerate with `npx convex dev` after connecting a deployment. */
import type * as cleanup from "../cleanup.js";
import type * as multipartUploadData from "../multipartUploadData.js";
import type * as multipartUploads from "../multipartUploads.js";
import type * as r2 from "../r2.js";
import type * as videoPasswordData from "../videoPasswordData.js";
import type * as videoPasswords from "../videoPasswords.js";
import type * as videoActions from "../videoActions.js";
import type * as videoAssets from "../videoAssets.js";
import type * as videoTranscription from "../videoTranscription.js";
import type * as videoShareData from "../videoShareData.js";
import type * as videoShares from "../videoShares.js";
import type * as videoFlowV2 from "../videoFlowV2.js";
import type * as videoFlowV2Actions from "../videoFlowV2Actions.js";
import type * as videos from "../videos.js";
import type * as videosPublic from "../videosPublic.js";
import type { ApiFromModules, FilterApi, FunctionReference } from "convex/server";

declare const fullApi: ApiFromModules<{
  cleanup: typeof cleanup;
  multipartUploadData: typeof multipartUploadData;
  multipartUploads: typeof multipartUploads;
  r2: typeof r2;
  videoPasswordData: typeof videoPasswordData;
  videoPasswords: typeof videoPasswords;
  videoActions: typeof videoActions;
  videoAssets: typeof videoAssets;
  videoTranscription: typeof videoTranscription;
  videoShareData: typeof videoShareData;
  videoShares: typeof videoShares;
  videoFlowV2: typeof videoFlowV2;
  videoFlowV2Actions: typeof videoFlowV2Actions;
  videos: typeof videos;
  videosPublic: typeof videosPublic;
}>;

export declare const api: FilterApi<typeof fullApi, FunctionReference<any, "public">>;
export declare const internal: FilterApi<typeof fullApi, FunctionReference<any, "internal">>;
export declare const components: {
  r2: import("@convex-dev/r2/_generated/component.js").ComponentApi<"r2">;
};
