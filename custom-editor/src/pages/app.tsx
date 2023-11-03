import { useState } from 'react';

import Editor from '../components/editor';
import SummaryCard from '../components/summaryCard';

import classes from './styles.module.css';

const ESSAY = `
Memories from the past resonate across generations and serve as chilling reminders of humanity's past mistakes. Art Spiegelman's Maus, a graphic novel, and Anthony Giacchino's Colette, a short film, tell two tales of confronting memories of the past. Using color, personal perspectives, intimate conversations, and juxtaposition of past and present, both works lead an audience through the horrifying memories of war and convey a sense of hope and resilience despite the deep sadness and heavy burden the survivors still carry with them.
Both Maus and Colette utilize different choices of color to emphasize different themes. Maus primarily uses a black-and-white color palette to set a heavy and dark tone for the novel. The lack of color symbolizes the hopelessness and cruelty of the war. The omission of bright colors forces the readers to focus more on the images and texts and interpret them on their own without the influence of colors. Conversely, the vibrant and lively colors in Colette evoke a sense of hope and rebirth. For example, the greenness the viewers see during Colette's visit to the remains of the concentration camp (Giacchino 14:24) provides a sense of rebirth as it symbolizes the potential for growth and renewal from the past. The scene takes place on the grounds of a concentration camp, drawing a stark contrast between the apparent bleakness of the location’s history and its present tranquility.
Memories of war are often told from the perspective of glorious heroes. However, both Maus and Colette present their narratives through the personal stories of two ordinary individuals. Employing this approach humanizes the characters’ experiences and enables readers to foster a deeper connection with their stories. In Maus, Spiegelman delves into the personal life of his father, Vladek, and presents him not as a heroic survivor, but as a flawed character. By including details about Vladek's romantic relationships with Lucia and Anja, the author provides a personal touch to its protagonist. The readers are drawn to Vladek for not only his story but also because he is an interesting and complex individual. As Spiegelman himself states, such personal stories make the narrative "more real - more human" (Spiegelman 23). Similarly, Colette portrays the experience of an ordinary woman. Although the film does not give much background on Colette's personal life, viewers can get closer to her by hearing her voice and seeing her actions up close. For example, at her goodbye party (Giacchino 3:53 - 4:40), viewers can see Colette dancing with friends, laughing, and eating. To someone who doesn’t know Colette, she seems to be an ordinary individual at a party with friends. Yet she is about to embark on a journey where she will confront the memories of the war. As she stated afterward, “[she] will never be the same again” (1:25). Although there are no dramatic scenes or ominous music, these simple words convey the deep burden Colette carries with her.
Intimate conversations are present throughout Maus and Colette to deepen the audience's connections to the characters and their stories. In Maus, Spiegelman preserves characters' colloquialisms, accents, and idiosyncrasies. In doing so, Spiegelman captures the authenticity of their stories and enables readers to empathize with the characters. The familiar tone and mannerisms mirror everyday conversations. Through the dialogue between a father and son, the readers feel almost as if they are eavesdropping on a live conversation between two people. Additionally, the inclusion of thought bubbles in Maus sheds insight into characters' internal thoughts and emotions and adds another dimension to the intimate dialogue, a technique that cannot be easily employed in films. Similarly, Colette employs intimate conversations to capture the voices and perspectives of the protagonists, bridging the gap between viewers and the protagonists. The films revolve around conversations between Colette and her young travel companion, Lucie Fouble -  a dialogue between two generations, old and young. Their conversations are as much about revisiting the memories of the past, as about how the past can be used to shape the future. Though on camera, the characters appear genuine and their conversations do not feel rehearsed, helping to preserve the authenticity of their interactions. 
 Finally, both Maus and Colette juxtapose painful memories of the past with scenes from the present, creating a sharp contrast and amplifying the narrative's emotional resonance. In Maus, Spiegelman bleeds panels together, creating smoother transitions between past and present. He weaves together two storylines - Vladek’s past and the present - enabling readers to witness firsthand the traumatic effects of the war on his father's life. The flashbacks to Vladek's past show an aspiring young man, trying to make a life for himself. This not only provides historical context but also serves as a reminder of the life that was uprooted by the war. Similarly, Colette employs the juxtaposition of past and present to illuminate the lasting impact of the war on its titular character. Colette's memories of her time in the French resistance and living in Nazi-occupied France are interwoven with scenes from her present life, conveying a stark contrast between her turbulent past and the relative calm of the present. The juxtaposition highlights the enduring emotional weight of Colette's experiences, demonstrating how the traumas of war have shaped her identity and continue to influence her present reality.
Art Spiegelman's Maus and Anthony Giacchino's Colette are two powerful works that tell the story of ordinary people confronting the painful memories of war. While both works delve into the harrowing experiences of individuals impacted by the war, they employ different narrative and artistic techniques to convey their messages. By exploring the effects of the past on the lives of individuals, Maus and Colette serve as poignant reminders that memories of war are not just a personal burden but something that can be taught to ensure that tragedies are not repeated.
`;

export default function App() {
    const [cards, updateCards] = useState<Card[]>([]);

    const [focused, updateFocused] = useState<number | null>(null);

    return (
        <div className={ classes.container }>
            <div className={ classes.essayContainer }>
                <Editor focused={ (focused !== null ? cards[focused] : null) } focusedIndex={ focused } updateCards={ updateCards } />

                <div className={ classes.cardsContainer }>
                    {
                        cards.map(
                            (card, index) => (
                                <SummaryCard cardIndex={ index } key={ index } card={ card } selected={ index === focused } onClick={ updateFocused } />
                            )
                        )
                    }
                </div>
            </div>
        </div>
    );
}
