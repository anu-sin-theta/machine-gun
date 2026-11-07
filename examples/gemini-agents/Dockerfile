# The example agents as one container: every agent on $PORT under /agents/<id>.
#   docker build -t kavach-agents examples/gemini-agents
#   docker run -p 8080:8080 -e GEMINI_API_KEY=... kavach-agents
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY agents.mjs server.mjs ./
ENV PORT=8080 \
    GEMINI_MODEL=gemini-3.8-flash \
    HEDERA_NETWORK=testnet
EXPOSE 8080
USER node
CMD ["node", "server.mjs"]
