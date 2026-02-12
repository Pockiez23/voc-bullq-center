// src/server.ts
import { Elysia } from "elysia";
import { jobRoute } from "./routes/job.route";

const app = new Elysia();

app.use(jobRoute);

app.listen(3000);

console.log("🚀 API running at http://localhost:3000");
