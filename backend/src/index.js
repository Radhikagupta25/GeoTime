import dotenv from "dotenv";
dotenv.config();

import app from "./app.js";

const PORT = process.env.PORT;

app.listen(PORT, () => {
    console.log(`GeoTime server running on port ${PORT}`);
});
