type Social = {
	label: string;
	link: string;
};

type Presentation = {
	mail: string;
	title: string;
	description: string;
	socials: Social[];
	profile?: string;
};

const presentation: Presentation = {
	mail: "thegeekywanderer@gmail.com",
	title: "Hi, I’m Karan! ",
	profile: "/profile.webp",
	description: "",
	socials: [
		{
			label: "X",
			link: "https://twitter.com/thegeekywander",
		},
		{
			label: "Github",
			link: "https://github.com/thegeekywanderer",
		},
		{
			label: "Linkedin",
			link: "https://www.linkedin.com/in/thegeekywanderer/",
		},
		{
			label: "Bento",
			link: "https://bento.me/thegeekywanderer",
		},
	],
};

export default presentation;
