import { createApp } from './app.ts';

const port=Number(process.env.PORT??4301);
const app=createApp();
app.listen(port,()=>console.log(`Folio server listening on http://localhost:${port}`));
