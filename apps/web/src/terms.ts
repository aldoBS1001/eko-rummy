// Términos y condiciones de EKO RUMMY. Un solo texto para la app y para el PDF.
// BORRADOR PARA REVISIÓN LEGAL: completa los datos marcados en LEGAL y haz que un abogado lo revise antes de publicar.

export const TERMS_VERSION = '2026-10-14';
export const TERMS_DATE = '14 de octubre de 2026';

/** Datos de la empresa que el operador debe completar. */
export const LEGAL = {
  entity: 'Business Shop',
  entityFull: 'BUSINESS STORE, S.A. de C.V.',
  address: 'Boca del Río, Veracruz, México [completar domicilio fiscal]',
  email: '[correo de soporte]',
  city: 'Boca del Río, Veracruz',
};

export interface Section { title: string; body: (string | string[])[] }

export const TERMS: Section[] = [
  { title: '1. Quiénes somos', body: [
    `EKO RUMMY es un juego de fichas operado por ${LEGAL.entity} (${LEGAL.entityFull}), con domicilio en ${LEGAL.address}, en adelante "nosotros". Forma parte del ecosistema EKO K'iin.`,
    `Contacto: ${LEGAL.email}.`,
  ] },
  { title: '2. Aceptación', body: [
    'Al usar EKO RUMMY en cualquiera de sus versiones (web, Android, iPhone o Windows) aceptas estos términos y el aviso de privacidad. Si no estás de acuerdo, no uses el juego.',
  ] },
  { title: '3. Edad y elegibilidad', body: [
    'El juego gratuito contra la IA y en línea está disponible para todo público. Si eres menor de 18 años, usa el juego con permiso y supervisión de tu madre, padre o tutor.',
    'Las funciones Web3 (billetera y token EKOKIIN) y cualquier función con valor económico son exclusivamente para personas mayores de 18 años, o de la mayoría de edad que fije la ley de tu país si es mayor.',
    'Al indicar "Soy mayor de edad" declaras bajo tu responsabilidad que lo eres. Esa declaración no sustituye la verificación de identidad: para cualquier función con valor económico te pediremos comprobar tu edad e identidad. Declarar una edad falsa es causa de suspensión de la cuenta.',
    'Verificación de identidad (KYC). La realiza nuestro proveedor Sumsub con una identificación oficial vigente y una selfie en video. Solo las cuentas verificadas y mayores de edad podrán participar en funciones con valor económico. Podemos rechazar o revocar una verificación si detectamos documentos falsos, suplantación o datos que no coinciden.',
  ] },
  { title: '4. El juego gratuito', body: [
    'Jugar EKO RUMMY no requiere pagar, comprar ni conectar una billetera. Los puntos, la clasificación y los torneos gratuitos no tienen valor económico, no se canjean por dinero, tokens ni premios y no pueden transferirse.',
  ] },
  { title: '5. Cuentas y conducta', body: [
    'Eres responsable de tu cuenta y de mantener segura tu contraseña. Está prohibido:',
    ['usar programas, bots o asistencia automatizada para jugar;', 'ponerse de acuerdo con otros jugadores para manipular partidas (colusión);', 'aprovechar errores del sistema o intentar alterar el servidor;', 'insultar, acosar, discriminar o publicar enlaces o contenido ilegal en el chat;', 'crear cuentas múltiples para obtener ventajas o evadir sanciones.'],
    'Podemos advertir, suspender o cancelar cuentas que incumplan estas reglas, y anular los resultados afectados.',
  ] },
  { title: '6. Compras de artículos estéticos', body: [
    'La tienda vende temas, diseños de fichas, avatares y membresías que solo cambian la apariencia del juego. No dan ventajas, no tienen valor de canje y no se convierten en fichas, saldo, tokens ni dinero.',
    'Los pagos con tarjeta los procesa Stripe; no almacenamos datos completos de tarjetas. Los precios se muestran en pesos mexicanos. Las solicitudes de reembolso se atienden en ' + LEGAL.email + ' conforme a la ley aplicable y a las reglas de la tienda de aplicaciones que hayas usado.',
  ] },
  { title: '7. Web3 y token EKOKIIN', body: [
    'La conexión con TronLink es opcional y solo de lectura: mostramos tu dirección pública, tu saldo y tus movimientos de EKOKIIN. Nunca te pediremos tu frase semilla ni tu llave privada; si alguien lo hace en nuestro nombre, es un fraude.',
    'Las operaciones en la red TRON son irreversibles, pueden cobrar comisiones de red y son tu responsabilidad. No custodiamos tus fondos.',
    'EKO RUMMY no asigna, promete ni garantiza un precio, rendimiento o respaldo para el token EKOKIIN. El valor de los activos digitales puede bajar a cero. Nada en el juego es asesoría financiera ni una invitación a invertir.',
  ] },
  { title: '8. Partidas con valor económico (apuestas)', body: [
    '8.1 Estado actual. Las partidas en las que se apuesta dinero o tokens están DESACTIVADAS. Hoy no aceptamos depósitos, no bloqueamos tokens, no cobramos comisiones por partida y no pagamos premios.',
    '8.2 Condiciones para habilitarlas. Solo se activarán si antes contamos con: el permiso de la Secretaría de Gobernación y las demás autorizaciones que exija la ley para juegos con apuesta; verificación de edad, identidad y ubicación (KYC); controles contra lavado de dinero; proveedores financieros autorizados; contratos inteligentes auditados por terceros independientes; y políticas de juego responsable y de resolución de disputas. Te avisaremos y deberás aceptar condiciones específicas antes de participar.',
    '8.3 Lo que conlleva apostar. Si en el futuro participas en una partida con valor económico, entiendes y aceptas que:',
    [
      'puedes perder la totalidad de lo que apuestes; nunca apuestes dinero que necesites para vivir, pagar deudas o cubrir gastos esenciales;',
      'el resultado depende de tu habilidad y también del azar del reparto de fichas; ganar partidas anteriores no garantiza ganar las siguientes;',
      'apostar no es una inversión ni una fuente de ingresos;',
      'cada partida puede cobrar una comisión que se mostrará antes de que confirmes, junto con el monto, las reglas y el reparto del premio;',
      'el valor de los tokens puede cambiar entre que apuestas y recibes un premio;',
      'deberás comprobar tu identidad y, cuando la ley lo exija, el origen de tus fondos; podemos retener premios mientras se verifica;',
      'los premios pueden estar sujetos a impuestos y retenciones conforme a la ley aplicable; tú eres responsable de declararlos;',
      'está prohibido a menores de edad y a personas en jurisdicciones donde no esté permitido; participar desde ellas anula la partida y los premios;',
      'la desconexión, el abandono o el tiempo agotado se resuelven con las reglas publicadas; la colusión, los bots o la manipulación anulan la partida y pueden causar la pérdida de lo apostado y la suspensión;',
      'las disputas se revisan con el registro auditado de la partida; las transacciones en cadena no pueden revertirse.',
    ],
    '8.4 Juego responsable. Tendrás herramientas para fijar límites de monto y de tiempo y para autoexcluirte por un periodo. Señales de alerta: apostar más de lo planeado, intentar recuperar lo perdido, ocultarlo a tu familia, pedir prestado para apostar o sentir ansiedad cuando no juegas. Si te identificas con alguna, detente y busca apoyo. En México puedes llamar gratis las 24 horas a la Línea de la Vida: 800 911 2000.',
  ] },
  { title: '9. Privacidad (resumen)', body: [
    'Tratamos tu nombre de usuario, contraseña cifrada, historial de partidas, mensajes de chat, compras, dirección pública de billetera si la vinculas, tu declaración de edad y aceptación de estos términos, y datos técnicos como la dirección IP, para operar el juego, prevenir trampas y fraude, atender soporte y cumplir obligaciones legales.',
    'Si haces la verificación de identidad, Sumsub (Sum and Substance Ltd.) trata, como encargado y por cuenta nuestra, tu identificación oficial y datos biométricos de tu rostro, que son datos sensibles; por eso te pedimos tu consentimiento expreso antes de iniciarla. Nosotros no guardamos tus documentos ni fotografías: solo el identificador del trámite y su resultado.',
    `Puedes ejercer tus derechos de acceso, rectificación, cancelación y oposición escribiendo a ${LEGAL.email}. El aviso de privacidad completo detalla las finalidades y transferencias.`,
  ] },
  { title: '10. Propiedad intelectual', body: [
    "EKO RUMMY, EKO K'iin, Business Shop, sus logotipos, personajes, diseños y software nos pertenecen o tenemos licencia para usarlos. Recibes una licencia personal, no exclusiva e intransferible para jugar. No puedes copiar, modificar ni distribuir el juego sin autorización.",
  ] },
  { title: '11. Disponibilidad del servicio', body: [
    'Hacemos lo posible por mantener el juego disponible, pero puede haber interrupciones, mantenimiento o cambios. Podemos modificar o retirar funciones, siempre respetando lo que ya hayas pagado conforme a la ley.',
  ] },
  { title: '12. Responsabilidad', body: [
    'El juego se ofrece tal como está. En la medida que la ley lo permita, no respondemos por pérdidas derivadas del uso de billeteras o redes de terceros, de la volatilidad de activos digitales ni de fallas ajenas a nuestro control. Nada en estos términos limita los derechos que te otorga la Ley Federal de Protección al Consumidor.',
  ] },
  { title: '13. Cambios a estos términos', body: [
    `Versión ${TERMS_VERSION}. Si los cambiamos, te pediremos aceptarlos de nuevo dentro del juego antes de seguir usando las funciones afectadas.`,
  ] },
  { title: '14. Ley aplicable', body: [
    `Estos términos se rigen por las leyes federales de los Estados Unidos Mexicanos. Para cualquier controversia, las partes se someten a los tribunales competentes de ${LEGAL.city}, sin perjuicio de los derechos que tengas como consumidor ante la PROFECO.`,
  ] },
];
