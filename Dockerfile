FROM ghcr.io/puppeteer/puppeteer:latest

# Switch to root to install dependencies/copy files
USER root

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the app source code
COPY . .

# Expose port 3000
EXPOSE 3000

# Start the server
CMD ["node", "server.js"]
