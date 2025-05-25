require('dotenv').config();
const tmi = require('tmi.js');
const fs = require('fs');
const path = require('path');
const express = require('express'); // Opcional: para acceso en tiempo real a archivos

const config = {
  twitch: {
    clientId: process.env.TWITCH_CLIENT_ID,
    clientSecret: process.env.TWITCH_CLIENT_SECRET,
    token: process.env.TWITCH_TOKEN,
    channel: 'blackelespanolito',
    owner: 'blackelespanolito',
  },
};

// Estado inicial
let atracosActivos = false;
let lastRankingTime = 0;

const COOLDOWN_ATRACO = 28; // 28 segundos
const COOLDOWN_RANKING = 15; // 15 segundos
const INTERVALO_SOSPECHOSO = 30100; // 30.1 segundos en milisegundos
const lastPuntajeTime = new Map();
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

// Archivos de datos (usando volumen persistente en /app/data)
const archivoAtracos = '/app/data/atracos.json';
const archivoLegendarios = '/app/data/legendarios.json';
const archivoContadores = '/app/data/contadores.json';
const archivoIntervalos = '/app/data/intervalos.json';
const archivoTramposos = '/app/data/tramposos.json';
const archivoInfocajas = '/app/data/infocajas.json';

let atracosDB = {};
let legendariosDB = [];
let contadoresDB = {
  total_atracos: 0,
  comun: 0,
  raro: 0,
  ultrararo: 0,
  epico: 0,
  legendario: 0,
};
let intervalosDB = {};
let trampososDB = { usuarios: [] };
let infocajasDB = {
  total_cajas: 0,
  comun: 0,
  raro: 0,
  ultrararo: 0,
  epico: 0,
  legendario: 0,
};

// Inicializar servidor Express (opcional, para acceso en tiempo real)
const app = express();
app.get('/data/:file', (req, res) => {
  const file = req.params.file;
  const validFiles = ['atracos.json', 'intervalos.json', 'tramposos.json', 'infocajas.json', 'legendarios.json', 'contadores.json'];
  if (validFiles.includes(file)) {
    res.sendFile(path.join('/app/data', file));
  } else {
    res.status(404).send('Archivo no encontrado');
  }
});
app.listen(process.env.PORT || 3000, () => console.log('Servidor de archivos iniciado en puerto 3000'));

client.connect()
  .then(() => console.log(`✅ Bot conectado al canal ${config.twitch.channel}`))
  .catch((err) => console.error('❌ Error al conectar:', err));

// Cargar o inicializar archivos
function cargarArchivo(archivo, defaultData) {
  if (fs.existsSync(archivo)) {
    try {
      return JSON.parse(fs.readFileSync(archivo));
    } catch (error) {
      console.error(`❌ Error al cargar ${archivo}:`, error);
      return defaultData;
    }
  } else {
    fs.writeFileSync(archivo, JSON.stringify(defaultData, null, 2));
    console.log(`✅ Archivo ${archivo} creado.`);
    return defaultData;
  }
}

atracosDB = cargarArchivo(archivoAtracos, {});
legendariosDB = cargarArchivo(archivoLegendarios, []);
contadoresDB = cargarArchivo(archivoContadores, contadoresDB);
intervalosDB = cargarArchivo(archivoIntervalos, {});
trampososDB = cargarArchivo(archivoTramposos, { usuarios: [] });
infocajasDB = cargarArchivo(archivoInfocajas, infocajasDB);

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
    hour12: false,
  }).replace(/(\d+)\/(\d+)\/(\d+),/, '$3-$2-$1');
}

// Guardar datos en archivos
function guardarArchivo(archivo, data) {
  try {
    fs.writeFileSync(archivo, JSON.stringify(data, null, 2));
    console.log(`✅ ${archivo} actualizado.`);
  } catch (error) {
    console.error(`❌ Error al guardar ${archivo}:`, error);
  }
}

function guardarPuntajes() {
  guardarArchivo(archivoAtracos, atracosDB);
}

function guardarLegendarios() {
  guardarArchivo(archivoLegendarios, legendariosDB);
}

function guardarContadores() {
  guardarArchivo(archivoContadores, contadoresDB);
}

function guardarIntervalos() {
  guardarArchivo(archivoIntervalos, intervalosDB);
}

function guardarTramposos() {
  guardarArchivo(archivoTramposos, trampososDB);
}

function guardarInfocajas() {
  guardarArchivo(archivoInfocajas, infocajasDB);
}

// Resetear ranking con respaldo
function resetearRanking(channel) {
  const timestamp = Date.now();
  const backupFile = `/app/data/atracos_backup_${timestamp}.json`;
  const backupData = {
    timestamp: getLocalTimestamp(),
    puntajes: atracosDB,
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

// Mostrar ranking
function mostrarRanking(channel) {
  const currentTime = Date.now();

  if ((currentTime - lastRankingTime) / 1000 < COOLDOWN_RANKING) {
    return; // Ignorar silenciosamente si está en cooldown
  }

  lastRankingTime = currentTime;

  const usuarios = Object.entries(atracosDB);
  if (usuarios.length === 0) {
    client.say(channel, '🏆 No hay puntajes registrados aún. ¡Usa !atracar para empezar!');
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

// Manejo de mensajes
client.on('message', async (channel, tags, message, self) => {
  if (self) return;
  const username = tags.username.toLowerCase();
  const isModerator = tags.mod || (tags.badges && tags.badges.moderator);
  const isBroadcaster = username === config.twitch.channel.toLowerCase();

  if (message.trim().toLowerCase() === '!iniciar') {
    if (!isModerator && !isBroadcaster) {
      client.say(channel, 'Solo los moderadores o el dueño del canal pueden usar !iniciar.');
      return;
    }
    if (atracosActivos) {
      client.say(channel, '📦 El sistema de atracos ya está activado.');
      return;
    }
    atracosActivos = true;
    client.say(channel, 'yellowcase ¡El sistema de atracos ha comenzado! Usa !atracar para intentarlo.');
    console.log('✅ Sistema de atracos activado');
    return;
  }

  if (message.trim().toLowerCase() === '!fin') {
    if (!isModerator && !isBroadcaster) {
      client.say(channel, 'Solo los moderadores o el dueño del canal pueden usar !fin.');
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
      client.say(channel, 'Solo los moderadores o el dueño del canal pueden usar !resetrank.');
      return;
    }
    resetearRanking(channel);
    return;
  }

  if (message.trim().toLowerCase() === '!ranking') {
    if (!isModerator && !isBroadcaster) {
      client.say(channel, 'Solo los moderadores o el dueño del canal pueden usar !ranking.');
      return;
    }
    mostrarRanking(channel);
    return;
  }

  if (message.trim().toLowerCase() !== '!atracar') return;

  if (!atracosActivos) {
    return;
  }

  const currentTime = Date.now();
  const lastTime = lastPuntajeTime.get(username) || 0;

  if ((currentTime - lastTime) / 1000 < COOLDOWN_ATRACO) {
    const remainingTime = Math.ceil(COOLDOWN_ATRACO - (currentTime - lastTime) / 1000);
    client.say(channel, `@${username}, espera ${remainingTime} segundos antes de intentar atracar nuevamente.`);
    return;
  }

  lastPuntajeTime.set(username, currentTime);

  // Registrar intervalo efectivo
  if (!intervalosDB[username]) {
    intervalosDB[username] = [];
  }
  if (lastTime !== 0) {
    const intervalo = currentTime - lastTime;
    intervalosDB[username].push(intervalo);
    if (intervalosDB[username].length > 10) {
      intervalosDB[username].shift();
    }

    // Verificar si el intervalo es sospechoso (<= 30.1 segundos)
    if (intervalo <= INTERVALO_SOSPECHOSO) {
      const ultimosIntervalos = intervalosDB[username].slice(-5);
      const mediaIntervalos = Math.round(
        ultimosIntervalos.reduce((sum, val) => sum + val, 0) / ultimosIntervalos.length
      );
      trampososDB.usuarios.push({
        nombre: username,
        intervalo_ms: intervalo,
        intervalos: intervalosDB[username].slice(-3),
        timestamp: new Date().toISOString(),
        tiempoRespuesta_ms: 15000, // Valor aproximado
      });
      guardarTramposos();
    }
    guardarIntervalos();
  }

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
      timestamp: getLocalTimestamp(),
    });
    guardarLegendarios();
  }

  // Actualizar contadores
  contadoresDB.total_atracos += 1;
  contadoresDB[tipoObjeto] += 1;
  guardarContadores();

  // Actualizar infocajas
  infocajasDB.total_cajas += 1;
  infocajasDB[tipoObjeto] += 1;
  guardarInfocajas();

  guardarPuntajes();

  // Mensajes según el tipo de objeto
  switch (tipoObjeto) {
    case 'común':
      mensaje = `@${username}, atracaste y obtuviste una Mil-Spec Bluecase Obtienes ${puntos} puntos. Tienes un total de ${atracosDB[username]} puntos`;
      break;
    case 'raro':
      mensaje = `@${username}, atracaste y obtuviste una Restricted Violetcase Obtienes ${puntos} puntos. Tienes un total de ${atracosDB[username]} puntos`;
      break;
    case 'ultrararo':
      mensaje = `@${username}, atracaste y obtuviste una Classified Pinkcase Obtienes ${puntos} puntos. Tienes un total de ${atracosDB[username]} puntos`;
      break;
    case 'épico':
      mensaje = `@${username}, atracaste y obtuviste una Covert Redcase Obtienes ${puntos} puntos. Tienes un total de ${atracosDB[username]} puntos`;
      break;
    case 'legendario':
      mensaje = `@${username}, atracaste y obtuviste... ¡UN CUCHILLO! Yellowcase Obtienes ${puntos} puntos. Tienes un total de ${atracosDB[username]} puntos`;
      break;
  }

  client.say(channel, mensaje);
});

console.log(`Conectando al canal ${config.twitch.channel} con el bot ${client.opts.identity.username}...`);