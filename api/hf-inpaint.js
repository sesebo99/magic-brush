export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const HF_TOKEN = process.env.HF_TOKEN;
  if (!HF_TOKEN) {
    return res.status(500).send('HF_TOKEN is not set on Vercel');
  }

  try {
    const { image, mask, prompt } = req.body;

    // Base64からバイナリBufferへ変換
    const imageBuffer = Buffer.from(image.replace(/^data:image\/\w+;base64,/, ''), 'base64');
    const maskBuffer = Buffer.from(mask.replace(/^data:image\/\w+;base64,/, ''), 'base64');

    const formData = new FormData();
    formData.append('image', new Blob([imageBuffer], { type: 'image/png' }), 'image.png');
    formData.append('mask', new Blob([maskBuffer], { type: 'image/png' }), 'mask.png');
    formData.append('prompt', prompt);

    const response = await fetch('https://api-inference.huggingface.co/models/runwayml/stable-diffusion-inpainting', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${HF_TOKEN}`
      },
      body: formData
    });

    const data = await response.arrayBuffer();
    res.setHeader('Content-Type', response.headers.get('content-type') || 'image/png');
    return res.status(response.status).send(Buffer.from(data));
  } catch (error) {
    return res.status(500).send(error.message);
  }
}
