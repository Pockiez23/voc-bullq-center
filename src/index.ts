import { Elysia } from "elysia";
import { startCron } from "./cron/job.cron";
import { jobRoute } from "./routes/job.route";


const app = new Elysia();

app.use(jobRoute);

startCron();

app.listen(3000);
console.log("🚀 Server running on http://localhost:3000");
