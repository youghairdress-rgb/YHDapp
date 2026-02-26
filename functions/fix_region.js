const fs = require("fs");
let content = fs.readFileSync("index.js", "utf8");
content = content.replace(/functionsV1\.(runWith|https|firestore)/g, "functionsV1.region(\"asia-northeast1\").$1");
fs.writeFileSync("index.js", content, "utf8");
