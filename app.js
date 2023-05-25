const TelegramApi = require("node-telegram-bot-api");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion } = require("mongodb");

dotenv.config();

//Подлкючаемся к API Telegram
const bot = new TelegramApi(process.env.BOT_TOKEN, { polling: true });

// Подключаемся к БД
const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@cluster0.wsj4xle.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
const db = client.db(process.env.DB_NAME);
const collection = db.collection(process.env.COLLECTION_NAME);

// Работа с сообщениями в боте
bot.on("message", async (msg) => {
  const text = msg.text;
  const senderChatId = msg.chat.id;
  const senderName = msg.from.first_name;
  const senderUserName = msg.from.username;
  const opts = {
    parse_mode: "Markdown",
  };
  const templateMessage =
    "*Формат сообщения:*\n\n" +
    "дд/мм/гг чч:мм\n" +
    "Название мероприятия\n" +
    "Место проведения или ссылка\n" +
    "Список участников (опционально)\n\n" +
    "*Пример:*\n\n" +
    "01/01/2024 10:00\n" +
    "Собеседование\n" +
    "https://meet.google.com/caz-tmqa-yge\n" +
    "@user1, @user2, @user3 \n\n" +
    "*PS:* Если не указаны участники, сообщение будет отправлено всем подписчикам SecretaryBot";

  if (text === "/start") {
    // Отправляем приветственное сообщение
    bot.sendMessage(
      senderChatId,
      "*Добро пожаловать! Это бот - секретарь.*\n" +
        "Я умею отправлять приглашения на мероприятия.\n\n" +
        "Команды:\n" +
        "/help - Посмотреть формат приглашения\n" +
        "/stop - Отписаться",
      opts
    );

    // Добавляем нового участника в базу
    await addParticipant(msg.chat);
    const AllParticipantsData = await getAllParticipants(senderUserName);
    AllParticipantsData.forEach((participant) => {
      const chatId = participant.id;
      bot.sendMessage(
        chatId,
        `_SecretaryBot_: У нас новый участник - ${senderName} (@${senderUserName})!`,
        opts
      );
    });
  } else if (text === "/help") {
    // Отправляем шаблон сообщения
    bot.sendMessage(senderChatId, templateMessage, opts);
  } else if (text === "/stop") {
    // Удаляем участника из БД
    await deleteParticipant(senderChatId);
    bot.sendMessage(senderChatId, "_SecretaryBot_: Вы отписались", opts);
  } else {
    // Проверяем формат сообщения
    if (checkMessageFormat(text)) {
      // Разделяем сообщение на части
      const [date, time, title, point, userNames] = parseMessage(text);
      // console.log("userNames", userNames);
      if (userNames) {
        // Ищем в БД указанных участников
        const participantsData = await findParticipant(userNames);
        if (participantsData[0]) {
          participantsData.forEach(async (participant) => {
            const chatId = participant.id;
            const firstName = participant.first_name;
            // console.log("chatId", chatId);

            // Отправляем каждому участнику приглашение
            bot.sendMessage(
              chatId,
              `${firstName}, ${senderName} пригласил вас на мероприятие *${title}* ${date} в ${time}. Место встречи: ${point}`,
              opts
            );
            // Оповещаем отправителя об успешной отправке
            bot.sendMessage(
              senderChatId,
              "_SecretaryBot_: Приглашение отправлено",
              opts
            );
          });
        } else {
          // Оповещаем отправителя если указанные участники не найдены в БД
          bot.sendMessage(
            senderChatId,
            "_SecretaryBot_: Указанные участники не найдены",
            opts
          );
        }
      } else {
        // Получаем всех участников кроме отправителя из БД
        const AllParticipantsData = await getAllParticipants(senderUserName);
        AllParticipantsData.forEach((participant) => {
          const chatId = participant.id;
          const firstName = participant.first_name;
          // Каждому участнику отправляем приглашение
          bot.sendMessage(
            chatId,
            `${firstName}, ${senderName} пригласил вас на мероприятие *${title}* ${date} в ${time}. Место встречи: ${point}`,
            opts
          );
          // Оповещаем отправителя об успешной отправке приглашения
          bot.sendMessage(
            senderChatId,
            "_SecretaryBot_: Приглашение отправлено всем подписчикам",
            opts
          );
        });
      }
    } else {
      // Оповещаем отправителя о несоответствии формата приглашения шаблону
      bot.sendMessage(
        senderChatId,
        "_SecretaryBot_: Cообщение не соответствует формату",
        opts
      );
      // Отправляем сообщение с шаблоном
      bot.sendMessage(senderChatId, templateMessage, opts);
    }
  }
});

// Функция добавления нового участника в БД
async function addParticipant(newParticipant) {
  await client.connect();
  const checkParticipant = await collection
    .find({ id: newParticipant.id })
    .toArray();
  if (!checkParticipant[0]) {
    try {
      await collection.insertOne(newParticipant);
      console.log("Участник успешно добавлен");
    } catch (error) {
      console.error("Ошибка при добавлении нового участника", error);
    } finally {
      await client.close();
    }
  }
}

// Функция удаления участника из БД
async function deleteParticipant(participantId) {
  await client.connect();
  try {
    await collection.deleteOne({ id: participantId });
    console.log("Участник успешно удален");
  } catch (error) {
    console.error("Ошибка при удалении участника", error);
  } finally {
    await client.close();
  }
}

// Функция поиска участника в БД
async function findParticipant(userNames) {
  try {
    await client.connect();
    const participantsData = await collection
      .find({ username: { $in: userNames } })
      .toArray();
    return participantsData;
  } catch (error) {
    console.error("Ошибка поиска участника", error);
  } finally {
    await client.close();
  }
}

// Функция получения всех участников из БД кроме отправителя
async function getAllParticipants(sender) {
  try {
    await client.connect();
    const AllParticipantsData = await collection
      .find({ username: { $ne: sender } })
      .toArray();
    // console.log("AllParticipantsData", AllParticipantsData);
    return AllParticipantsData;
  } catch (error) {
    console.error("Ошибка получения данных из БД", error);
  } finally {
    await client.close();
  }
}

// Функция проверки формата приглашения по шаблону
function checkMessageFormat(text) {
  const pattern =
    /^(\d{2}[\/.]\d{2}[\/.]\d{4})\s+(\d{2}:\d{2})\s+(.+)\s+(.+)(?:\s+(@?\w+(?:[,\s]*@?\w+)*)?)?$/;
  return pattern.test(text);
}

// Функция разделения приглашения на части с прасваиванием переменным
function parseMessage(text) {
  const parse = text.split("\n");
  const date = formatDate(parse[0].split(" ")[0]);
  const time = parse[0].split(" ")[1];
  const title = parse[1];
  const point = parse[2];
  let userNames;
  if (parse[3]) {
    userNames = parse[3].split(/[,\s]+/).map((username) => {
      if (username.charAt(0) === "@") {
        return username.slice(1);        
      }
      return username;
    });
  } else {
    userNames = null;
  }
  return [date, time, title, point, userNames];
}

// Функция преобразования даты в строку нужного формата
function formatDate(date) {
  const fulldate = date.split(/[\/.]/);
  const day = parseInt(fulldate[0]);
  const month = parseInt(fulldate[1]);
  const year = parseInt(fulldate[2]); 
  const monthNames = [
    "января",
    "февраля",
    "марта",
    "апреля",
    "мая",
    "июня",
    "июля",
    "августа",
    "сентября",
    "октября",
    "ноября",
    "декабря",
  ];
  return `${day} ${monthNames[month - 1]} ${year}`;
}
