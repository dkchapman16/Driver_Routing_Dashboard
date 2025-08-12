import express from 'express';
import { Pool } from 'pg';
import lanesRouter from './routes/lanes';

const app = express();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

app.use(express.json());

app.use('/api/lanes', lanesRouter(pool));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

export default app;
