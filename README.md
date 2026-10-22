# Poster Pro

Un plugin de [Kino](https://github.com/kinotvapp/kino-plugins) que **rellena el póster que falte**. Cuando un título
de cualquiera de tus fuentes llega sin póster (o sin fondo), Poster Pro busca uno, **con la nota incrustada** (IMDb,
Rotten Tomatoes…), y se lo da a Kino. Si la imagen no falta, no hace nada.

*English: fills in the poster (and backdrop) a title is missing, with the rating drawn on it. It adds no catalogue and
plays nothing; Kino only asks it about a title that has a gap.*

![Ícono](icon.png)

## Qué hace (y qué no)

- **Solo entra cuando falta una imagen.** Kino consulta primero TMDB y AniList; Poster Pro es lo último que mira, así
  que nunca cambia un póster que ya existe.
- **No agrega catálogo, no reproduce y no pide cuenta ni registro.** Aparece en Plugins, pero no tiene sección propia.
- **Solo entrega imágenes que de verdad existen.** Cada imagen se comprueba antes de dársela a Kino. Si ninguna
  responde, el hueco se queda como estaba: nunca una imagen rota ni una imagen genérica.
- **Fondo opcional.** También puede rellenar el fondo (solo cuando el título no trae uno). Se apaga en los ajustes.

## De dónde sale cada póster

En este orden, y cada uno comprobado:

1. **El servidor preferido** (OpenPosterDB o RatingPosterDB), con la nota dibujada en el póster.
2. **El otro servidor**, que acepta la misma clave gratuita. Se prueban a la vez.
3. **La lista de imágenes de TMDB** para ese título en cualquier idioma: el póster que el filtro de idioma de Kino
   se saltó.

Detalles que se midieron contra los servidores reales:

| Servidor | Si no conoce el título | Qué hace Poster Pro |
| --- | --- | --- |
| OpenPosterDB | responde 404 | se fía de su respuesta, y le pasa el id de IMDb o de TMDB |
| RatingPosterDB | con un id de IMDb **desconocido** responde una imagen genérica; con uno de TMDB, 404 | solo le pasa ids de TMDB; un id de IMDb se convierte antes a TMDB |

La clave pública gratuita `t0-free-rpdb` funciona en los dos. Los fondos con nota de RatingPosterDB son de pago:
Poster Pro no los pide ahí, y con la clave gratuita los toma de OpenPosterDB o de TMDB.

## Instalarlo

Aparece en **Plugins ▸ Recomendados**. También a mano:

1. Abre Kino ▸ **Plugins** ▸ **+**.
2. Escribe `kinotvapp/kino-plugin-poster-pro` y toca **Agregar** ▸ **Instalar**.

La hoja de instalación avisa de los dos servidores con los que habla (`openposterdb.com` y `api.ratingposterdb.com`).
Necesita Kino **0.9.55** o más nuevo.

## Configurarlo

Viene **puesto para funcionar**: instalas y ya rellena.

| Ajuste | Qué hace |
| --- | --- |
| **Servidor preferido** | OpenPosterDB (gratis) o RatingPosterDB. Si el preferido no tiene la imagen, se prueba el otro. |
| **Clave del servidor** | Viene la gratuita `t0-free-rpdb`. Si pones la tuya, se guarda como un ajuste más, **sin cifrar**: no la compartas. |
| **Notas en el póster** | Las que tenga el servidor, solo IMDb, o IMDb y Rotten Tomatoes. Solo con OpenPosterDB. |
| **Rellenar también el fondo** | Encendido por defecto. |
| **Diagnóstico** | Una línea que dice qué funciona (cada servidor, los fondos y TMDB) y un botón **Probar los servidores**. |

## Cómo funciona por dentro

- Implementa `meta` (apiVersion 9) y se declara `catalogOnly`, así que Kino nunca le pide reproducir ni lo lista como
  fuente de un título.
- **Presupuesto de tiempo.** Kino da 6 s a una consulta `meta` y apaga un plugin que se agota tres veces seguidas;
  Poster Pro corta cada paso a lo que queda de 4,5 s y responde «nada que añadir» en vez de fallar.
- **Memoria.** Lo que encontró se guarda 24 h (y un «no» solo 30 min, porque un servidor puede estar caído una hora y
  tener la imagen a la siguiente), junto con la conversión de IMDb a TMDB, que no cambia.
- **No lanza errores** desde `meta`: devuelve `null`.

## Qué no hace

- No cambia las imágenes de tus otras fuentes: solo llena huecos.
- No pone logos: Kino no tiene ese campo para un título.
- No trae canales ni listas.

## Créditos

Las imágenes con nota son de [OpenPosterDB](https://openposterdb.com) y de
[RatingPosterDB](https://ratingposterdb.com); las fichas y las imágenes de respaldo, de TMDB, a través de Kino. Sin
afiliación con ninguno de ellos. La idea de usar esos servidores en Kino la mostró el plugin PosterX; Poster Pro es
código nuevo, centrado en rellenar lo que falta.

Licencia: Apache-2.0 (ver `LICENSE`).
