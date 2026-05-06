const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();

const authRoutes = require("./routes/auth");

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);

mongoose.connect(process.env.MONGO_URI)
.then(() => console.log("MongoDB conectado"))
.catch(err => console.log(err));

app.get("/", (req, res) => {
  res.send("API funcionando");
});

const PORT = 5000;

app.listen(PORT, () => {
  console.log("Servidor rodando na porta " + PORT);
});