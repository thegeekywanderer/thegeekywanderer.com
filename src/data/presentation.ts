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
	description:
		"Salut! I'm *thegeekywanderer*, an Indian coding enthusiast who loves exploring both in code and on adventures. I work with *Go, Rust, and Python*, focusing on problem-solving while crafting systems and always gathering knowledge to innovate in my own coding journey.",
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
