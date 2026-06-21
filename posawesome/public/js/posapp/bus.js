import mitt from "mitt";

const emitter = mitt();

export { emitter };

export default {
	install: (app, options) => {
		app.config.globalProperties.__ = window.__;
		app.config.globalProperties.frappe = window.frappe;
		app.config.globalProperties.eventBus = emitter;
	},
};
