const fs = require("fs");
let content = fs.readFileSync("index.js", "utf8");
content = content.replace(/^(exports\.\w+\s*=\s*)(functionsV1\.)/gm, "$1functionsV1.region(\"asia-northeast1\").");
fs.writeFileSync("index.js", content, "utf8");
