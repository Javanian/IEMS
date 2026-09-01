const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/process-control', require('./routes/processControlRoutes'));

const PORT = 3002;
app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));
