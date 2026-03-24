// server.js - Backend Node.js pour la gestion des candidatures

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configuration du stockage des fichiers (temporaire en mémoire)
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB max
});

// Fonction pour envoyer un email via l'API Brevo (REST)
async function sendEmailViaBrevoAPI(to, subject, htmlContent, attachments = []) {
  const payload = {
    sender: { email: process.env.EMAIL_FROM || 'noreply@votreentreprise.fr', name: 'VTC Candidatures' },
    to: [{ email: to }],
    subject: subject,
    htmlContent: htmlContent
  };

  // Ajouter les pièces jointes seulement s'il y en a
  if (attachments && attachments.length > 0) {
    const attachmentsFormatted = attachments.map(att => ({
      name: att.filename,
      content: att.content.toString('base64')
    }));
    payload.attachment = attachmentsFormatted;
  }

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'api-key': process.env.BREVO_API_KEY,
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Brevo API error: ${error}`);
  }

  return await response.json();
}

// Stockage en mémoire des candidatures (pour le dashboard)
// En production, utilisez une vraie base de données
let candidatures = [];
let nextId = 1;

// Route pour soumettre une candidature
app.post('/api/candidatures', upload.fields([
  { name: 'carteIdentite', maxCount: 2 },
  { name: 'carteVitale', maxCount: 1 },
  { name: 'permis', maxCount: 2 },
  { name: 'carteVTC', maxCount: 2 },
  { name: 'carteGrise', maxCount: 1 },
  { name: 'photoVehicule', maxCount: 1 },
  { name: 'memoAssurance', maxCount: 1 },
  { name: 'attestationTitreOnereuse', maxCount: 1 },
  { name: 'justificatifDomicile', maxCount: 1 },
  { name: 'rib', maxCount: 1 }
]), async (req, res) => {
  try {
    const { fullName, email, phone, city, declaration, remarque } = req.body;
    
    // Préparer les pièces jointes
    const attachments = [];
    const documents = {};
    
    Object.keys(req.files).forEach(fieldName => {
      documents[fieldName] = [];
      req.files[fieldName].forEach(file => {
        attachments.push({
          filename: file.originalname,
          content: file.buffer
        });
        documents[fieldName].push({
          name: file.originalname,
          size: file.size,
          type: file.mimetype
        });
      });
    });

    // Créer la candidature
    const candidature = {
      id: nextId++,
      fullName,
      email,
      phone,
      city,
      declaration,
      remarque,
      documents,
      status: 'nouveau',
      submittedDate: new Date().toISOString()
    };
    
    candidatures.push(candidature);

    // Email à l'admin avec tous les documents
    const adminMailOptions = {
      from: process.env.EMAIL_FROM || 'candidatures@votreentreprise.fr',
      to: process.env.EMAIL_ADMIN || 'votre-email@gmail.com', // VOTRE EMAIL ICI
      subject: `🚗 Nouvelle candidature chauffeur : ${fullName}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: 'Arial', sans-serif; background: #fafaf8; padding: 20px; }
            .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
            .header { background: linear-gradient(135deg, #C9A961 0%, #B89751 100%); color: white; padding: 30px; text-align: center; }
            .content { padding: 30px; }
            .info-row { margin: 15px 0; padding: 15px; background: #f5f5f3; border-radius: 4px; }
            .label { font-size: 12px; color: #6b6b6b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 5px; }
            .value { font-size: 15px; color: #1a1a1a; font-weight: 500; }
            .documents { margin-top: 20px; padding: 20px; background: #f5f5f3; border-radius: 4px; }
            .doc-item { margin: 8px 0; color: #1a1a1a; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0; font-size: 28px; font-weight: 300;">Nouvelle Candidature</h1>
              <p style="margin: 10px 0 0 0; opacity: 0.9;">Chauffeur VTC</p>
            </div>
            <div class="content">
              <div class="info-row">
                <div class="label">Nom complet</div>
                <div class="value">${fullName}</div>
              </div>
              
              <div class="info-row">
                <div class="label">Email</div>
                <div class="value">${email}</div>
              </div>
              
              <div class="info-row">
                <div class="label">Téléphone</div>
                <div class="value">${phone}</div>
              </div>
              
              <div class="info-row">
                <div class="label">Ville</div>
                <div class="value">${city}</div>
              </div>
              
              <div class="info-row">
                <div class="label">Déclaration avec fiche de paie</div>
                <div class="value">${declaration || 'Non'}</div>
              </div>
              
              ${remarque ? `
              <div class="info-row">
                <div class="label">Remarque</div>
                <div class="value">${remarque}</div>
              </div>
              ` : ''}
              
              <div class="documents">
                <div class="label" style="margin-bottom: 10px;">Documents joints (${attachments.length} fichiers)</div>
                ${Object.entries(documents).map(([type, files]) => `
                  <div style="margin-top: 10px;">
                    <strong style="color: #C9A961;">${type}</strong>
                    ${files.map(f => `<div class="doc-item">📎 ${f.name}</div>`).join('')}
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
        </body>
        </html>
      `,
      attachments: attachments
    };

    // Email de confirmation au candidat
    const candidatMailOptions = {
      from: process.env.EMAIL_FROM || 'noreply@votreentreprise.fr',
      to: email,
      subject: 'Candidature reçue - Chauffeur VTC',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: 'Arial', sans-serif; background: #fafaf8; padding: 20px; }
            .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
            .header { background: linear-gradient(135deg, #C9A961 0%, #B89751 100%); color: white; padding: 40px 30px; text-align: center; }
            .content { padding: 40px 30px; }
            .check { width: 60px; height: 60px; background: rgba(255,255,255,0.2); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; font-size: 30px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="check">✓</div>
              <h1 style="margin: 0; font-size: 28px; font-weight: 300;">Candidature reçue</h1>
            </div>
            <div class="content">
              <p style="font-size: 16px; color: #1a1a1a; line-height: 1.6;">
                Bonjour <strong>${fullName}</strong>,
              </p>
              <p style="font-size: 16px; color: #1a1a1a; line-height: 1.6;">
                Nous avons bien reçu votre candidature pour un poste de chauffeur VTC. 
                Tous vos documents ont été enregistrés avec succès.
              </p>
              <p style="font-size: 16px; color: #1a1a1a; line-height: 1.6;">
                Notre équipe va étudier votre dossier et nous reviendrons vers vous dans les plus brefs délais.
              </p>
              <p style="font-size: 14px; color: #6b6b6b; margin-top: 30px; line-height: 1.6;">
                Cordialement,<br>
                L'équipe de recrutement
              </p>
            </div>
          </div>
        </body>
        </html>
      `
    };

    // Envoyer les emails via l'API Brevo
    await sendEmailViaBrevoAPI(
      process.env.EMAIL_ADMIN || 'votre-email@gmail.com',
      `🚗 Nouvelle candidature chauffeur : ${fullName}`,
      adminMailOptions.html,
      attachments
    );

    await sendEmailViaBrevoAPI(
      email,
      'Candidature reçue - Chauffeur VTC',
      candidatMailOptions.html
    );

    res.json({ 
      success: true, 
      message: 'Candidature envoyée avec succès',
      id: candidature.id
    });

  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erreur lors de l\'envoi de la candidature' 
    });
  }
});

// Route pour récupérer toutes les candidatures (pour le dashboard)
app.get('/api/candidatures', (req, res) => {
  res.json(candidatures);
});

// Route pour mettre à jour le statut d'une candidature
app.patch('/api/candidatures/:id/status', (req, res) => {
  const id = parseInt(req.params.id);
  const { status } = req.body;
  
  const candidature = candidatures.find(c => c.id === id);
  if (candidature) {
    candidature.status = status;
    res.json({ success: true, candidature });
  } else {
    res.status(404).json({ success: false, error: 'Candidature non trouvée' });
  }
});

// Route pour envoyer un email à un candidat depuis le dashboard
app.post('/api/candidatures/:id/send-email', async (req, res) => {
  const id = parseInt(req.params.id);
  const candidature = candidatures.find(c => c.id === id);
  
  if (!candidature) {
    return res.status(404).json({ success: false, error: 'Candidature non trouvée' });
  }

  try {
    await sendEmailViaBrevoAPI(
      candidature.email,
      `Votre candidature - ${candidature.fullName}`,
      `<p>Bonjour ${candidature.fullName},</p><p>Nous vous contactons concernant votre candidature...</p>`
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Erreur d\'envoi' });
  }
});

// Démarrer le serveur
app.listen(PORT, () => {
  console.log(`✅ Serveur démarré sur le port ${PORT}`);
  console.log(`📧 Email admin: ${process.env.EMAIL_ADMIN}`);
});

module.exports = app;
