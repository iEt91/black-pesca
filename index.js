require('dotenv').config();
const tmi = require('tmi.js');
const fs = require('fs');

const config = {
  twitch: {
    clientId: process.env.TWITCH_CLIENT_ID,
    clientSecret: process.env.TWITCH_CLIENT_SECRET,
    token: process.env.TWITCH_TOKEN,
    channel: 'blackelespanolito',
  },
};

// Estado inicial
let atracosActivos = false;
let lastRankingTime = 0;

const COOLDOWN_ATRACO = 28;
const COOLDOWN_RANKING = 15;
const lastAtracoTime = new Map();
const PUNTAJE_ATRACO = { comun: 1, raro: 5, ultrararo: 25, epico: 100, legendario: 500 };
const PROBABILIDADES = [0.7992, 0.9590, 0.9910, 0.9974, 1.0];

const client = new tmi.Client({
  options: { debug: true },
  connection: { secure: true, reconnect: true },
  identity: {
    username: 'tangov91_bot',
    password: `oauth:${process.env.TWITCH_TOKEN}`,
  },
  channels: [config.twitch.channel],
});

client.connect()
  .then(() => console.log(`✅ Bot conectado al canal ${config.twitch.channel}`))
  .catch((err) => console.error('❌ Error al conectar:', err));

const archivoAtracos = 'atracos.json';
const archivoLegendarios = 'legendarios.json';
const archivoContadores = 'contadores.json';
let atracosDB = {};
let legendariosDB = [];
let contadoresDB = {
  total_atracos: 0,
  comun: 0,
  raro: 0,
  ultrararo: 0,
  epico: 0,
  legendario: 0
};

if (fs.existsSync(archivoAtracos)) {
  try {
    atracosDB = JSON.parse(fs.readFileSync(archivoAtracos));
  } catch (error) {
    console.error('❌ Error al cargar atracos.json:', error);
  }
} else {
  fs.writeFileSync(archivoAtracos, JSON.stringify({}));
  console.log('✅ Archivo atracos.json creado.');
}

if (fs.existsSync(archivoLegendarios)) {
  try {
    legendariosDB = JSON.parse(fs.readFileSync(archivoLegendarios));
  } catch (error) {
    console.error('❌ Error al cargar legendarios.json:', error);
  }
} else {
  fs.writeFileSync(archivoLegendarios, JSON.stringify([]));
  console.log('✅ Archivo legendarios.json creado.');
}

if (fs.existsSync(archivoContadores)) {
  try {
    contadoresDB = JSON.parse(fs.readFileSync(archivoContadores));
  } catch (error) {
    console.error('❌ Error al cargar contadores.json:', error);
  }
} else {
  fs.writeFileSync(archivoContadores, JSON.stringify(contadoresDB, null, 2));
  console.log('✅ Archivo contadores.json creado.');
}

// Función para obtener timestamp en ART
function getLocalTimestamp() {
  return new Date().toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).replace(/(\d+)\/(\d+)\/(\d+),/, '$3-$2-$1');
}

function guardarPuntajes() {
  try {
    fs.writeFileSync(archivoAtracos, JSON.stringify(atracosDB, null, 2));
    console.log('✅ Base de datos de atracos actualizada.');
  } catch (error) {
    console.error('❌ Error al guardar atracos.json:', error);
  }
}

function guardarLegendarios() {
  try {
    fs.writeFileSync(archivoLegendarios, JSON.stringify(legendariosDB, null, 2));
    console.log('✅ Base de datos de legendarios actualizada.');
  } catch (error) {
    console.error('❌ Error al guardar legendarios.json:', error);
  }
}

function guardarContadores() {
  try {
    fs.writeFileSync(archivoContadores, JSON.stringify(contadoresDB, null, 2));
    console.log('✅ Base de datos de contadores actualizada.');
  } catch (error) {
    console.error('❌ Error al guardar contadores.json:', error);
  }
}

function resetearRanking(channel) {
  const timestamp = Date.now();
  const backupFile = `atracos_backup_${timestamp}.json`;
  const backupData = {
    timestamp: getLocalTimestamp(),
    puntajes: atracosDB
  };
  try {
    fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2));
    console.log(`✅ Copia de seguridad creada: ${backupFile}`);
  } catch (error) {
    console.error('❌ Error al crear copia de seguridad:', error);
  }

  atracosDB = {};
  guardarPuntajes();
  client.say(channel, '🏆 ¡El ranking ha sido reiniciado! Todos los puntajes se han establecido a cero.');
  console.log('✅ Ranking reiniciado');
}

function mostrarRanking(channel) {
  const currentTime = Date.now();

  // Verificar cooldown global
  if ((currentTime - lastRankingTime) / 1000 < COOLDOWN_RANKING) {
    return; // Ignorar silenciosamente si está en cooldown
  }

  lastRankingTime = currentTime;

  const usuarios = Object.entries(atracosDB);
  if (usuarios.length === 0) {
    client.say(channel, '🏆 No hay puntajes registrados aún. ¡Usa !atraco para empezar!');
    return;
  }

  usuarios.sort((a, b) => b[1] - a[1]);

  const topN = Math.min(5, usuarios.length);
  let mensaje = `🏆 Top ${topN} jugadores: `;
  for (let i = 0; i < topN; i++) {
    mensaje += `${i + 1}. ${usuarios[i][0]} (${usuarios[i][1]} puntos) `;
  }
  client.say(channel, mensaje);
}

client.on('message', async (channel, tags, message, self) => {
  if (self) return;
  const username = tags.username.toLowerCase();
  const isModerator = tags.mod || (tags.badges && tags.badges.moderator);
  const isBroadcaster = username === config.twitch.channel.toLowerCase();

  if (message.trim().toLowerCase() === '!iniciar') {
    if (!isModerator && !isBroadcaster) {
      return;
    }
    if (atracosActivos) {
      client.say(channel, '📦 El sistema de atracos ya está activado.');
      return;
    }
    atracosActivos = true;
    client.say(channel, 'yellowcase ¡El sistema de atracos ha comenzado! Usa !atraco para intentarlo.');
    console.log('✅ Sistema de atracos activado');
    return;
  }

  if (message.trim().toLowerCase() === '!fin') {
    if (!isModerator && !isBroadcaster) {
      return;
    }
    if (!atracosActivos) {
      client.say(channel, '🚫 El sistema de atracos ya está desactivado.');
      return;
    }
    atracosActivos = false;
    client.say(channel, '🚫 ¡El sistema de atracos ha finalizado! Gracias por participar.');
    console.log('✅ Sistema de atracos desactivado');
    return;
  }

  if (message.trim().toLowerCase() === '!resetrank') {
    if (!isModerator && !isBroadcaster) {
      return;
    }
    resetearRanking(channel);
    return;
  }

  if (message.trim().toLowerCase() === '!ranking') {
    mostrarRanking(channel);
    return;
  }

  if (message.trim().toLowerCase() !== '!atraco') return;

  if (!atracosActivos) {
    return;
  }

  const currentTime = Date.now();
  const lastTime = lastAtracoTime.get(username) || 0;

  if ((currentTime - lastTime) / 1000 < COOLDOWN_ATRACO) {
    const remainingTime = Math.ceil(COOLDOWN_ATRACO - (currentTime - lastTime) / 1000);
    client.say(channel, `${username}, espera ${remainingTime} segundos antes de intentar otro atraco.`);
    return;
  }

  lastAtracoTime.set(username, currentTime);

  const random = Math.random();
  let tipoObjeto = 'común';
  let puntos = PUNTAJE_ATRACO.comun;
  let mensaje;

  if (random >= 0.7992 && random < 0.9590) {
    tipoObjeto = 'raro';
    puntos = PUNTAJE_ATRACO.raro;
  } else if (random >= 0.9590 && random < 0.9910) {
    tipoObjeto = 'ultrararo';
    puntos = PUNTAJE_ATRACO.ultrararo;
  } else if (random >= 0.9910 && random < 0.9974) {
    tipoObjeto = 'épico';
    puntos = PUNTAJE_ATRACO.epico;
  } else if (random >= 0.9974 && random <= 1.0) {
    tipoObjeto = 'legendario';
    puntos = PUNTAJE_ATRACO.legendario;
  }

  atracosDB[username] = (atracosDB[username] || 0) + puntos;

  // Registrar item legendario en legendarios.json
  if (tipoObjeto === 'legendario') {
    legendariosDB.push({
      username: username,
      timestamp: getLocalTimestamp()
    });
    guardarLegendarios();
  }

  // Actualizar contadores
  contadoresDB.total_atracos += 1;
  contadoresDB[tipoObjeto] += 1;
  guardarContadores();

  guardarPuntajes();

  // Mensajes según el tipo de objeto
  switch (tipoObjeto) {
    case 'común':
      mensaje = `Realizaste un atraco y obtuviste una Mil-Spec Bluecase Obtienes ${puntos} puntos. Tienes un total de ${atracosDB[username]} puntos`;
      break;
    case 'raro':
      mensaje = `Realizaste un atraco y obtuviste una Restricted Violetcase Obtienes ${puntos} puntos. Tienes un total de ${atracosDB[username]} puntos`;
      break;
    case 'ultrararo':
      mensaje = `Realizaste un atraco y obtuviste una Classified Pinkcase Obtienes ${puntos} puntos. Tienes un total de ${atracosDB[username]} puntos`;
      break;
    case 'épico':
      mensaje = `Realizaste un atraco y obtuviste una Covert Redcase Obtienes ${puntos} puntos. Tienes un total de ${atracosDB[username]} puntos`;
      break;
    case 'legendario':
      mensaje = `Realizaste un atraco y obtuviste una UN CUCHILLO!!  Yellowcase Obtienes ${puntos} puntos. Tienes un total de ${atracosDB[username]} puntos`;
      break;
  }

  client.say(channel, mensaje);
});

console.log(`Conectando al canal ${config.twitch.channel} con el bot ${client.opts.identity.username}...`);