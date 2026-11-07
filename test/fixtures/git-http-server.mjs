// Minimal smart-HTTP git server for tests. Runs inside a container and bridges HTTP requests
// to `git http-backend`. It enforces Basic credentials per operation so tests can prove that
// fetches use the read token and pushes use the write token.
import { spawn } from "node:child_process";
import { createServer } from "node:http";

const [root, readToken, writeToken, port] = process.argv.slice(2);
const expected = (token) => `Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;

createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  const isPush = url.pathname.endsWith("/git-receive-pack") || url.searchParams.get("service") === "git-receive-pack";
  const authorization = request.headers.authorization ?? "";
  const allowed = isPush ? authorization === expected(writeToken) : [expected(readToken), expected(writeToken)].includes(authorization);
  if (!allowed) {
    response.writeHead(authorization ? 403 : 401, { "WWW-Authenticate": 'Basic realm="git"' });
    response.end("access denied");
    return;
  }

  const backend = spawn("git", ["http-backend"], {
    env: {
      PATH: process.env.PATH,
      GIT_PROJECT_ROOT: root,
      GIT_HTTP_EXPORT_ALL: "1",
      REQUEST_METHOD: request.method,
      PATH_INFO: url.pathname,
      QUERY_STRING: url.search.slice(1),
      CONTENT_TYPE: request.headers["content-type"] ?? "",
      CONTENT_LENGTH: request.headers["content-length"] ?? "",
      HTTP_CONTENT_ENCODING: request.headers["content-encoding"] ?? "",
      REMOTE_USER: "test",
      REMOTE_ADDR: "127.0.0.1",
    },
  });
  request.pipe(backend.stdin);
  backend.stdin.on("error", () => undefined);

  let buffered = Buffer.alloc(0);
  let headersSent = false;
  backend.stdout.on("data", (chunk) => {
    if (headersSent) {
      response.write(chunk);
      return;
    }
    buffered = Buffer.concat([buffered, chunk]);
    const end = buffered.indexOf("\r\n\r\n");
    if (end === -1) {
      return;
    }
    let status = 200;
    const headers = {};
    for (const line of buffered.subarray(0, end).toString().split("\r\n")) {
      const separator = line.indexOf(":");
      const name = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();
      if (name.toLowerCase() === "status") {
        status = Number(value.split(" ")[0]);
      } else {
        headers[name] = value;
      }
    }
    response.writeHead(status, headers);
    response.write(buffered.subarray(end + 4));
    headersSent = true;
  });
  backend.on("close", () => response.end());
}).listen(Number(port), "0.0.0.0");
