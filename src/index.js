const { startPulseScheduler } = require('./layers/pulse');

const startNodeServices = () => {
	startPulseScheduler();
	return true;
};

module.exports = { startNodeServices };
