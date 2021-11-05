const cheerio = require('cheerio');
const axios = require('axios');
const Redis = require("ioredis");

const discordWebhookUrl = process.env.DISCORD_WEBHOOK;
const redisConnectionString = process.env.REDIS_CONNECTION_STRING;

const url = 'https://www.ldlc.com/es-es/novedades/?sort=32';
const client = new Redis(redisConnectionString);
const baseProductUrl = 'https://www.ldlc.com'

let html;

const getItemData = ($item) => {
  const elementId = $item.attr('id');
  const id = $item.attr('data-id');
  const name = $item.find('.title-3 a').text();
  const description = $item.find('.desc').text();
  const productUrl = baseProductUrl + $item.find('.title-3 a').attr('href');

  const occurrences = html.match(new RegExp('\\("#'+elementId+' \.price"\\)\.replaceWith\\(\'<div class="price"><div class="price">(.*)€<sup>(.*)<\/sup>'))
  const [ _, euros, cents ] = occurrences
  const price = Number(euros) + Number(cents)/100

  return { elementId, id, name, description, price, productUrl };
}

(async () => {
  const response = await axios.get(url);
  html = response.data;
  const $ = cheerio.load(html);

  const lastIdSeen = await client.get('ldlc-id');
  if (!lastIdSeen) {
    const $lastItem = $('.pdt-item:first-child');
    const itemData = getItemData($lastItem)
    await client.set('ldlc-id', itemData.id);
    process.exit(0);
  }

  const $items = $('.pdt-item');
  const itemsData = [];
  let report = true;
  $items.each(
    (index, item) => {
      const data = getItemData($(item))
      if (report && data.id === lastIdSeen) {
        report = false;
      }
      if (report) {
        itemsData.push(data);
      }
    }
  )

  if (itemsData.length === 0) {
    process.exit(0);
  }

  const newLastIdSeen = itemsData[0].id;
  itemsData.reverse();
  const embeds = itemsData
    .map(
      data => ({
        title: data.name,
        description: data.description,
        url: data.productUrl,
        fields: [{ name: 'Precio', value: data.price.toString(), inline: 'true' }]
      })
    )

  const embedsChunks = embeds.length / 10
  for (let i = 0; i < embedsChunks; i++) {
    const start = i * 10;
    const end = start + 10;
    const embedsToSend = embeds.slice(start, end)
    try {
      await axios.post(discordWebhookUrl, { embeds: embedsToSend });
    } catch (e) {
      console.log(e)
    }
  }

  await client.set('ldlc-id', newLastIdSeen);
  process.exit(0);
})();
