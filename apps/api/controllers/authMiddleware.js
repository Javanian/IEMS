exports.requireToken = (req, res, next) => {
  if (!req.session?.trusted) {
    return res.status(403).json({
      message: 'token belum diverifikasi',
    });
  }

  next();
};
