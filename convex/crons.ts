import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.hourly("clean expired video data", { minuteUTC: 17 }, internal.cleanup.expired);
export default crons;
