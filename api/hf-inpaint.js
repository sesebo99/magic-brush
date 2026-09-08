export const config = {
  api: {
    bodyParser: false,
  },
};

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const HF_TOKEN = process.env.HF_TOKEN;
  if (!HF_TOKEN) {
    return res.status(500).send('HF_TOKEN is not set on Vercel');
  }

  try {
    const buf = await buffer(req);
    const contentType = req.headers['content-type'];

    const response = await fetch('https://api-inference.huggingface.co/models/runwayml/stable-diffusion-inpainting', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${HF_TOKEN}`,
        'Content-Type': contentType
      },
      body: buf
    });

    const data = await response.arrayBuffer();
    res.setHeader('Content-Type', response.headers.get('content-type') || 'image/png');
    return res.status(response.status).send(Buffer.from(data));
  } catch (error) {
    return res.status(500).send(error.message);
  }
}
