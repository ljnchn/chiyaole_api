import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { onError } from "./middleware/error";
import { authMiddleware } from "./middleware/auth";
import authRoutes from "./routes/auth";
import userRoutes from "./routes/users";
import medicationRoutes from "./routes/medications";
import checkinRoutes from "./routes/checkins";
import statRoutes from "./routes/stats";
import subscriptionRoutes from "./routes/subscriptions";

import "./db";

const app = new Hono().basePath("/v1");

app.use("*", cors());
app.use("*", logger());
app.onError(onError);

app.route("/auth", authRoutes);

app.use("/users/*", authMiddleware());
app.use("/medications/*", authMiddleware());
app.use("/checkins/*", authMiddleware());
app.use("/stats/*", authMiddleware());
app.use("/subscriptions/*", authMiddleware());

app.route("/users", userRoutes);
app.route("/medications", medicationRoutes);
app.route("/checkins", checkinRoutes);
app.route("/stats", statRoutes);
app.route("/subscriptions", subscriptionRoutes);

app.get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

const port = parseInt(process.env.PORT || "3000");

console.log(`🏥 吃药了 API server running on http://localhost:${port}`);
console.log(`📖 Base URL: http://localhost:${port}/v1`);

export default {
  port,
  fetch: app.fetch,
};
