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

    if (!image || !mask || !prompt) {
      return res.status(400).send('image, mask and prompt are required');
    }

    // Base64 → Buffer
    const imageBuffer = Buffer.from(
      image.replace(/^data:image\/\w+;base64,/, ''),
      'base64'
    );

    const maskBuffer = Buffer.from(
      mask.replace(/^data:image\/\w+;base64,/, ''),
      'base64'
    );

    // Multipart FormData
    const formData = new FormData();

    formData.append(
      'image',
      new Blob([imageBuffer], { type: 'image/png' }),
      'image.png'
    );

    formData.append(
      'mask',
      new Blob([maskBuffer], { type: 'image/png' }),
      'mask.png'
    );

    formData.append('prompt', prompt);

    const response = await fetch(
      'https://api-inference.huggingface.co/models/runwayml/stable-diffusion-inpainting',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${HF_TOKEN}`
        },
        body: formData,
        duplex: 'half'
      }
    );

    // HF側のエラーをそのまま確認できるようにする
    if (!response.ok) {
      const errorText = await response.text();

      console.error('Hugging Face Error:', response.status, errorText);

      return res
        .status(response.status)
        .send(`Hugging Face Error ${response.status}: ${errorText}`);
    }

    const result = await response.arrayBuffer();

    res.setHeader(
      'Content-Type',
      response.headers.get('content-type') || 'image/png'
    );

    return res.status(200).send(Buffer.from(result));

  } catch (error) {
    console.error('Server Error:', error);

    return res.status(500).send(
      `Server Error: ${error.message}`
    );
  }
}