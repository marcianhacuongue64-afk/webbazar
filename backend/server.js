// server.js
const express = require("express");
const cors = require("cors");
const db = require("./db");

const app = express();
app.use(cors());
app.use(express.json());

app.post("/receipts", (req, res) => {
  const { clientName, data, pdfFormat } = req.body;

  db.query(
    "INSERT INTO receipts (clientName, data, pdfFormat) VALUES (?, ?, ?)",
    [clientName, JSON.stringify(data), pdfFormat],
    (err, result) => {
      if (err) return res.status(500).send(err);
      res.send({ id: result.insertId });
    }
  );
});

app.get("/receipts", (req, res) => {
  db.query("SELECT * FROM receipts", (err, results) => {
    if (err) return res.status(500).send(err);

    const parsed = results.map(r => ({
      ...r,
      data: JSON.parse(r.data)
    }));

    res.send(parsed);
  });
});

app.listen(3001, () => console.log("API running on port 3001"));