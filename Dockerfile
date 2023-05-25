FROM node:alpine

WORKDIR /app

COPY package.json /app

COPY . .

RUN npm install

CMD ["node", "app.js"]